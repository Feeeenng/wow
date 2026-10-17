#[derive(Clone)]
pub(crate) struct Request {
    pub path: String,
    pub headers: std::collections::BTreeMap<String, String>,
    pub body: Vec<u8>,
}

/// 本机 HTTP 协议夹具不接触真实云端、S3 或用户录像。
pub(crate) fn server(
    count: usize,
    mut respond: impl FnMut(&Request, &str) -> (u16, serde_json::Value) + Send + 'static,
) -> (String, std::thread::JoinHandle<Vec<Request>>) {
    use std::{
        io::{Read, Write},
        time::{Duration, Instant},
    };
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let origin = endpoint.clone();
    let thread = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut requests = Vec::new();
        while requests.len() < count {
            let (mut socket, _) = match listener.accept() {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "协议请求数量不足");
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                }
                Err(error) => panic!("{error}"),
            };
            // Windows 接收套接字可能继承监听器的非阻塞标志，读取请求前显式恢复阻塞。
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut raw = Vec::new();
            let split = loop {
                let mut buffer = [0; 4096];
                let read = socket.read(&mut buffer).unwrap();
                assert!(read > 0);
                raw.extend_from_slice(&buffer[..read]);
                if let Some(index) = raw.windows(4).position(|value| value == b"\r\n\r\n") {
                    break index + 4;
                }
            };
            let head = String::from_utf8(raw[..split].to_vec()).unwrap();
            let headers = head
                .lines()
                .skip(1)
                .filter_map(|line| line.split_once(':'))
                .map(|(key, value)| (key.to_ascii_lowercase(), value.trim().to_string()))
                .collect::<std::collections::BTreeMap<_, _>>();
            let length = headers
                .get("content-length")
                .map(|value| value.parse::<usize>().unwrap())
                .unwrap_or(0);
            while raw.len() < split + length {
                let mut buffer = [0; 4096];
                let read = socket.read(&mut buffer).unwrap();
                assert!(read > 0);
                raw.extend_from_slice(&buffer[..read]);
            }
            let request = Request {
                path: head
                    .lines()
                    .next()
                    .unwrap()
                    .split_whitespace()
                    .nth(1)
                    .unwrap()
                    .to_string(),
                headers,
                body: raw[split..split + length].to_vec(),
            };
            let (status, body) = respond(&request, &origin);
            let bytes = serde_json::to_vec(&body).unwrap();
            let header = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",bytes.len());
            let _ = socket.write_all(header.as_bytes());
            let _ = socket.write_all(&bytes);
            requests.push(request);
        }
        requests
    });
    (endpoint, thread)
}
