const { h5Url } = require('../../config');

Page({
  data: {
    url: '',
    error: '',
  },
  onLoad(options) {
    if (!/^https:\/\/[^/]+/.test(h5Url) || /你的域名/.test(h5Url)) {
      this.setData({ error: '平台尚未配置访问地址，请联系管理员。' });
      return;
    }
    // ========== 微信登录桥 ==========
    // 通过 wx.login 拿 code，拼到 H5 URL 上，让工作台自动完成微信登录/绑定
    // 需要后端 /api/auth/wxlogin 与小程序 AppID/AppSecret 已配置
    if (wx.login) {
      wx.login({
        success: (res) => {
          if (res.code) {
            const sep = h5Url.includes('?') ? '&' : '?';
            const url = `${h5Url}${sep}wxcode=${encodeURIComponent(res.code)}`;
            this.setData({ url });
          } else this.setData({ url: h5Url });
        },
        fail: () => {
          this.setData({ url: h5Url });
        },
      });
    } else this.setData({ url: h5Url });
    // ========== 支付桥（占位） ==========
    // 将来 H5 通过 wx.miniProgram.postMessage 通知支付意图后，
    // 这里调用 wx.requestPayment 拉起微信支付；暂未接入。
  },
  onWebError() {
    this.setData({ url: '', error: '暂时无法打开平台，请检查网络后重新进入。' });
  },
});
