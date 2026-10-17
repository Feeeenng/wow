# Web静态站点部署说明

本目录的index.html、assets和game-data-NOTICE.txt组成独立Web复盘入口。使用静态Web服务器发布整个目录，保留资源相对结构，并把/api代理到本项目FastAPI。生产使用HTTPS。

以下同源Nginx示例作为TLS上游后的内部HTTP服务，公网入口保持HTTPS：

    server {
        listen 80;
        server_name replay.example.test;
        root /usr/share/nginx/html;

        location /api/ {
            access_log off;
            proxy_pass http://api:8000;
            proxy_http_version 1.1;
            proxy_set_header Authorization $http_authorization;
            proxy_set_header Range $http_range;
        }

        location / {
            try_files $uri $uri/ /index.html;
        }
    }

示例中的api是后端服务地址，域名、TLS和网络需按实际环境配置。该示例尚未在Linux容器矩阵验收，不能把本机浏览器通过等同生产部署通过。

后端需要数据库迁移、私有对象存储、Redis、独立Celery worker／beat及已创建的账号／团队。账号的访问令牌由管理员颁发，网页只验证当前权限；退出或刷新后需要重新验证。平台令牌、数据库和S3凭证均不写入静态文件。

个人布局要求后端显式升级至20261017_05，提供GET／PUT /api/v1/teams/{team_id}/preferences/replay。网页不自动迁移数据库。轨道布局中点击“保存个人布局”后按账号和团队存入服务端，重新登录后恢复；未保存草稿不会跨刷新保留。冲突时保留草稿，有修改时读取最新布局需要确认替换，不能无条件覆盖另一设备的修改。

网页播放通过Bearer及固定录像发布版本访问后端，后端逐片检查当前团队关系。复制的时间点链接只含团队、战斗、视角和共同时间；接收者仍需要登录并拥有团队权限。

技能资源的原始来源和许可保留在game-data-NOTICE.txt。视频、WCL报告和用户数据不包含在静态包内。
