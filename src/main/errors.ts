/** 主进程错误类型，IPC 透传给渲染层时转成 { code, message }。 */

export class AppError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class CipherUnavailableError extends AppError {
  constructor(msg: string) {
    super('CIPHER_UNAVAILABLE', msg);
  }
}

export class DriverError extends AppError {
  constructor(msg: string) {
    super('DRIVER_ERROR', msg);
  }
}

export class NotConnectedError extends AppError {
  constructor() {
    super('NOT_CONNECTED', '连接未打开或已关闭');
  }
}