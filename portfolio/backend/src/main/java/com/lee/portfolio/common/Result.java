package com.lee.portfolio.common;

import lombok.Data;

/**
 * 统一 RESTful 响应包装
 *
 * @param <T> 数据类型
 */
@Data
public class Result<T> {

    /** 0=成功，非0=失败 */
    private int code;
    private String message;
    private T data;

    public static <T> Result<T> ok() {
        return ok(null);
    }

    public static <T> Result<T> ok(T data) {
        Result<T> r = new Result<>();
        r.setCode(0);
        r.setMessage("success");
        r.setData(data);
        return r;
    }

    public static <T> Result<T> fail(int code, String message) {
        Result<T> r = new Result<>();
        r.setCode(code);
        r.setMessage(message);
        return r;
    }
}
