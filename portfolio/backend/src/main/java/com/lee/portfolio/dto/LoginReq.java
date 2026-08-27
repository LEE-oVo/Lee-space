package com.lee.portfolio.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;

/** 登录请求 */
@Data
public class LoginReq {

    @NotBlank(message = "不能为空")
    private String username;

    @NotBlank(message = "不能为空")
    private String password;
}
