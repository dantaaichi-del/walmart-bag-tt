# TT 适配验证记录

日期：2026-11-21。包版本：0.3.0-tt.1。

## 依据

核对 TauriTavern 构建 fff9af0333be 的以下作者源码：

- `src/scripts/extensions/runtime/asset-loader.js`：根manifest加载CSS和ES模块入口。
- `src/tauri/main/routes/extensions-routes.js`：Git仓库安装流程。
- `src/tauri/main/routes/resource-routes.js`：`/api/files/upload`、`/api/files/verify`。
- `src/scripts/st-context.js`：上下文提供 `getRequestHeaders`。
- `src/tauri/main/api/extension-store.js`、`extension_store_commands.rs`：原生 JSON / Blob 存储接口。
- `src/scripts/tauritavern/layout-kit.js`：free-window布局标记。

源码来源：https://github.com/Darkatse/TauriTavern/tree/fff9af0333be

## 通过的检查

- 10个JavaScript文件语法检查；相对模块、图像、CSS导入路径；全包只有一个根manifest。
- 模拟宿主执行真实入口和4个组件：购物袋只显示三个入口，各自调用正确面板并关闭其他面板。
- 模拟TT原生存储：音乐元数据与文件分开写入；原始音频字节及MIME类型保留。
- 巧克力导入的曲目可在小蝴蝶中读取、加入队列、解析本机音源。
- 聊天元数据只保存稳定曲目ID，不保存临时blob地址或音频字节。
- 视频和加密文件拒绝导入；新歌元数据写入失败时清理新音频，不影响已有歌曲。
- 修改曲名保留原音频；删除后不能用失效ID读取已删除曲目。
- 午夜男高中文和Emoji收藏按TT文件接口契约上传并回读。
- 启动、播放、曲库管理和收藏过程不调用模型，也不访问`/api/plugins/`。
- 小蝴蝶原有25项模拟交互回归检查通过。
- 午夜男高23项存储回归检查通过。

## 未完成的实机验证

- 真正的Android TauriTavern安装、Git克隆、CSS布局、触摸拖拽和音频解码。
- 本环境Chromium独立进程启动受限制，未把浏览器启动失败作为测试通过。
- 没有调用朋友的真实模型API；生成检查使用模拟返回值。
- 本仓库提供 Git 安装；安装后的首轮实机验收仍需由收件人完成。
