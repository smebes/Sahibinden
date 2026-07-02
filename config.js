const VIEW_BOT_API = {
  host: '51.102.128.78',
  port: 3009,
  get base() {
    return `http://${this.host}:${this.port}`;
  },
  get fleetUrl() {
    return `${this.base}/fleet?bot=sahibinden`;
  },
  apiPrefix: '/sahibinden',
  fleet: {
    heartbeatMin: 2
  }
};
