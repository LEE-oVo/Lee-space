package com.lee.portfolio.controller;

import com.lee.portfolio.common.Result;
import com.lee.portfolio.dto.ChangePasswordReq;
import com.lee.portfolio.dto.LoginReq;
import com.lee.portfolio.service.AdminService;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 后台认证接口：登录无需 token，其余 /api/admin/** 均需 JWT
 */
@RestController
@RequestMapping("/api/admin/auth")
public class AdminAuthController {

    private final AdminService adminService;

    public AdminAuthController(AdminService adminService) {
        this.adminService = adminService;
    }

    /** 登录：POST /api/admin/auth/login  {username, password} → {token, username} */
    @PostMapping("/login")
    public Result<Map<String, Object>> login(@Validated @RequestBody LoginReq req) {
        return Result.ok(adminService.login(req.getUsername(), req.getPassword()));
    }

    /** 修改密码：POST /api/admin/auth/password {oldPassword, newPassword} */
    @PostMapping("/password")
    public Result<Void> changePassword(@Validated @RequestBody ChangePasswordReq req) {
        adminService.changePassword(req.getOldPassword(), req.getNewPassword());
        return Result.ok();
    }
}
