# 团购预售网站

这是一个基于 GitHub Pages 的静态团购预售网站。

## 功能特性

- **无需登录**：用户直接访问即可使用
- **加入预订车**：点击产品即可加入本地预订车（使用 localStorage）
- **联系方式提交**：收集姓名、电话、邮箱和留言
- **GitHub Issue 自动创建**：提交表单后自动在 GitHub 创建 Issue，并发送通知
- **响应式设计**：电脑和手机均可良好显示

## 部署步骤

### 1. 创建 GitHub 仓库
- 登录 GitHub，创建新仓库：`tg-new`
- 进入仓库设置 → Pages
- Source 选择 `main` 分支，/ (root) 目录
- 保存后会自动生成站点 URL

### 2. 上传文件
- 将 `index.html` 上传到仓库根目录
- 可选：添加 `style.css` 和 `script.js` 等文件

### 3. 配置 GitHub Token
- 在 `index.html` 中找到并修改 token 变量
- 或直接在代码中配置（不推荐用于公开仓库）

### 4. 访问站点
- 访问 `https://lianchuzhong.github.io/tg-new/`
- 提交表单后数据将自动创建为 GitHub Issue

## 关键配置

### GitHub API 令牌
编辑 `index.html` 中的以下变量：
```javascript
const token = 'your_github_token_here';
```

### 仓库信息
修改提交函数中的：
- `const owner = 'lianchuzhong';` - GitHub 用户名
- `const repo = 'tg-new';` - 仓库名称

## 本地开发

```bash
# 使用任意 HTTP 服务器运行
npx serve

# 或使用 Python
python -m http.server 8000
```

访问 http://localhost:8000 查看效果。