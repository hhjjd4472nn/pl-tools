# pl-tools

Gopeed 扩展：粘贴网盘分享链接后直接下载。

## 安装

在 Gopeed 扩展页面输入本仓库地址安装。

若直连 github 失败，可用镜像：
```
https://gh-proxy.com/https://github.com/hhjjd4472nn/pl-tools
https://ghfast.top/https://github.com/hhjjd4472nn/pl-tools
https://ghproxy.net/https://github.com/hhjjd4472nn/pl-tools
```

## 使用

1. 在扩展设置里填写「百度网盘解析密码」
2. 新建任务，把网盘分享链接粘进去
   - 可以只粘链接
   - 也可以直接粘整段分享文字（会自动提取链接和提取码）
3. 解析完成后自动开始下载

## 支持的链接格式

- `https://pan.baidu.com/s/xxxxx?pwd=abcd`
- `https://pan.baidu.com/share/init?surl=xxxxx`
- 整段分享文字（自动识别）
- 无 http 前缀的裸链接

## 说明

- 当前支持百度网盘；迅雷、夸克适配器已预留，后续版本启用
- 解析密码有有效期，过期后在扩展设置里更新即可
- 解析站有限流，扩展已内置自动重试
