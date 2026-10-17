use std::{fs, path::PathBuf, process::{Child, Command, Stdio}, time::{Duration, Instant}};

use super::playlist::{media_playlist, segments};

struct Fixture { root: PathBuf, children: Vec<Child> }
impl Drop for Fixture {
    fn drop(&mut self) {
        for child in &mut self.children { let _ = child.kill(); let _ = child.wait(); }
        if !std::thread::panicking() { let _ = fs::remove_dir_all(&self.root); }
    }
}

fn port() -> u16 { std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port() }

/// 使用受管真实 MediaMTX 和 FFmpeg，验证与 WHIP 同编码的 H.264/Opus 滚动 HLS。
#[test]
fn h264_opus_history_exists_before_first_viewer_and_evicts_old_segments() {
    tauri::async_runtime::block_on(async {
        let mut fixture = Fixture { root: std::env::temp_dir().join(format!("wow-history-test-{}", uuid::Uuid::new_v4())), children: Vec::new() };
        fs::create_dir_all(&fixture.root).unwrap();
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let ffmpeg = resources.join("ffmpeg-runtime/bin/ffmpeg.exe");
        let sample = fixture.root.join("source.mp4");
        let generated = Command::new(&ffmpeg).args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "4", "-c:v", "libopenh264", "-g", "50", "-b:v", "400k", "-c:a", "libopus", "-y"]).arg(&sample).output().unwrap();
        assert!(generated.status.success(), "{}", String::from_utf8_lossy(&generated.stderr));
        let hls_port = port(); let rtsp_port = port();
        let history_directory = fixture.root.join("history");
        let config = crate::live::runtime::config::runtime_config_content(&history_directory)
            .replace("rtsp: false", &format!("rtsp: true\nrtspAddress: 127.0.0.1:{rtsp_port}\nrtspTransports: [tcp]"))
            .replace("webrtc: true", "webrtc: false")
            .replace(&format!("hlsAddress: 127.0.0.1:{}", crate::live::runtime::config::HISTORY_HTTP_PORT), &format!("hlsAddress: 127.0.0.1:{hls_port}"))
            .replace("hlsSegmentCount: 150", "hlsSegmentCount: 3");
        let configuration = fixture.root.join("test.yml"); fs::write(&configuration, config).unwrap();
        let log = fs::File::create(fixture.root.join("server.log")).unwrap();
        fixture.children.push(Command::new(resources.join("media-runtime/mediamtx.exe")).arg(&configuration).stdout(log.try_clone().unwrap()).stderr(log).spawn().unwrap());
        let started = Instant::now();
        while std::net::TcpStream::connect(("127.0.0.1", rtsp_port)).is_err() {
            assert!(started.elapsed() < Duration::from_secs(5), "媒体节点未启动：{}", fs::read_to_string(fixture.root.join("server.log")).unwrap_or_default());
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let log = fs::File::create(fixture.root.join("publisher.log")).unwrap();
        fixture.children.push(Command::new(&ffmpeg).args(["-hide_banner", "-loglevel", "error", "-re", "-stream_loop", "-1", "-i"]).arg(&sample)
            .args(["-c", "copy", "-f", "rtsp", "-rtsp_transport", "tcp"])
            .arg(format!("rtsp://127.0.0.1:{rtsp_port}/wow-recorder")).stdin(Stdio::null()).stdout(Stdio::null()).stderr(log).spawn().unwrap());
        // 首次 HTTP 请求前检查磁盘已有分片，证明无需先打开历史播放器。
        let before_request = Instant::now();
        loop {
            let entries = fs::read_dir(history_directory.join("wow-recorder")).ok().into_iter().flatten().flatten()
                .filter(|entry| entry.file_name().to_string_lossy().contains("_seg") && entry.path().extension().is_some_and(|ext| ext == "mp4")).count();
            if entries >= 2 { break; }
            assert!(before_request.elapsed() < Duration::from_secs(20), "没有提前生成历史分片：{}", fs::read_to_string(fixture.root.join("server.log")).unwrap_or_default());
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build().unwrap();
        let origin = format!("http://127.0.0.1:{hls_port}/wow-recorder");
        let ready = Instant::now();
        let (master, media) = loop {
            let result = async {
                let master = client.get(format!("{origin}/index.m3u8")).send().await.map_err(|error| error.to_string())?
                    .error_for_status().map_err(|error| error.to_string())?.text().await.map_err(|error| error.to_string())?;
                let media = media_playlist(&master)?;
                Ok::<_, String>((master, media))
            }.await;
            match result {
                Ok(result) => break result,
                Err(error) => assert!(ready.elapsed() < Duration::from_secs(25), "历史节点清单未就绪：{error}"),
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        };
        let initial = loop {
            let text = client.get(format!("{origin}/{media}")).send().await.unwrap().text().await.unwrap();
            if let Ok(segments) = segments(&text) { break segments; }
            assert!(before_request.elapsed() < Duration::from_secs(25), "节目时间尚未出现：{text}");
            tokio::time::sleep(Duration::from_millis(250)).await;
        };
        assert!(master.contains("opus"), "历史源未保留 Opus：{master}");
        let first = initial[0].file.clone();
        let until = Instant::now();
        loop {
            let text = client.get(format!("{origin}/{media}")).send().await.unwrap().text().await.unwrap();
            let next = segments(&text).unwrap();
            assert!(next.len() <= 3);
            if !text.lines().any(|line| line.trim() == first) { break; }
            assert!(until.elapsed() < Duration::from_secs(20), "滚动窗口没有淘汰旧片");
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        let expired = Instant::now();
        loop {
            if !client.get(format!("{origin}/{first}")).send().await.unwrap().status().is_success() { break; }
            assert!(expired.elapsed() < Duration::from_secs(15), "淘汰分片未在宽限期后释放");
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        println!("真实 H.264/Opus 历史窗口、节目时间锚点和分片淘汰通过");
    });
}
