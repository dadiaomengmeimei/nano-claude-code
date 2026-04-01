/**
 * @source ../src/utils/log.ts - log(), logError()
 * Original uses structured logging. Nano uses simple ANSI console output.
 */

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  info: '\x1b[36m',   // 青色 (cyan)
  warn: '\x1b[33m',   // 黄色 (yellow)
  error: '\x1b[31m',  // 红色 (red)
  gray: '\x1b[90m',   // 灰色 (gray) - 用于时间戳
};

/**
 * 获取当前时间戳 (HH:MM:SS)
 */
function getTimestamp(): string {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

/**
 * 格式化输出消息
 */
function formatMessage(level: string, color: string, message: string): string {
  const timestamp = `${colors.gray}[${getTimestamp()}]${colors.reset}`;
  const levelLabel = `${color}[${level.toUpperCase()}]${colors.reset}`;
  return `${timestamp} ${levelLabel} ${message}`;
}

export const logger = {
  /**
   * 信息级别日志 (青色)
   */
  info(message: string): void {
    console.log(formatMessage('info', colors.info, message));
  },

  /**
   * 警告级别日志 (黄色)
   */
  warn(message: string): void {
    console.log(formatMessage('warn', colors.warn, message));
  },

  /**
   * 错误级别日志 (红色)
   */
  error(message: string): void {
    console.error(formatMessage('error', colors.error, message));
  },
};

export default logger;
