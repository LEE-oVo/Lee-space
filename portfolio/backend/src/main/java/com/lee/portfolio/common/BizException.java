package com.lee.portfolio.common;

/**
 * 业务异常：携带 HTTP 状态语义的 code，由全局异常处理器统一转 Result
 */
public class BizException extends RuntimeException {

    private final int code;

    public BizException(int code, String message) {
        super(message);
        this.code = code;
    }

    public static BizException badRequest(String message) {
        return new BizException(400, message);
    }

    public static BizException unauthorized(String message) {
        return new BizException(401, message);
    }

    public static BizException notFound(String message) {
        return new BizException(404, message);
    }

    public int getCode() {
        return code;
    }
}
