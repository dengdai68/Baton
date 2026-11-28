# 手机端通用组件

这里维护按钮、导航控件、表单、输入框、状态提示和 Markdown 等通用界面组件。页面业务逻辑见 [features/](../features/README.md)，颜色和间距来自 [theme/](../theme/README.md)。

沟通与协作记录共用 `composer.tsx`。Android 的原生键盘测量视图放在禁用指针事件的 React Native `View` 内，屏幕仍可接收文本框、发送按钮和列表的触摸。
