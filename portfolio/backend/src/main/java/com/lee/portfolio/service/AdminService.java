package com.lee.portfolio.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.lee.portfolio.common.BizException;
import com.lee.portfolio.config.JwtUtil;
import com.lee.portfolio.entity.Admin;
import com.lee.portfolio.mapper.AdminMapper;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * 管理员服务：登录（签发 JWT）、修改密码
 */
@Service
public class AdminService {

    private final AdminMapper adminMapper;
    private final JwtUtil jwtUtil;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public AdminService(AdminMapper adminMapper, JwtUtil jwtUtil) {
        this.adminMapper = adminMapper;
        this.jwtUtil = jwtUtil;
    }

    /** 登录：校验账号密码，成功返回 token + 用户名 */
    public Map<String, Object> login(String username, String password) {
        Admin admin = adminMapper.selectOne(new QueryWrapper<Admin>().eq("username", username));
        if (admin == null || !encoder.matches(password, admin.getPassword())) {
            throw BizException.badRequest("用户名或密码错误");
        }
        Map<String, Object> data = new HashMap<>();
        data.put("token", jwtUtil.generate(admin.getUsername()));
        data.put("username", admin.getUsername());
        return data;
    }

    /** 修改密码：校验旧密码后更新 */
    public void changePassword(String oldPassword, String newPassword) {
        Admin admin = adminMapper.selectList(null).get(0);
        if (!encoder.matches(oldPassword, admin.getPassword())) {
            throw BizException.badRequest("原密码错误");
        }
        admin.setPassword(encoder.encode(newPassword));
        admin.setUpdateTime(LocalDateTime.now());
        adminMapper.updateById(admin);
    }
}
