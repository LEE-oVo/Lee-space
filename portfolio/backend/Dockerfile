# 后端构建镜像：多阶段构建
# 构建阶段复用 maven:3.9-eclipse-temurin-17（服务器已缓存）；.mvn 内为阿里云镜像配置
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY .mvn .mvn
COPY pom.xml .
RUN mvn -q dependency:go-offline
COPY src ./src
RUN mvn -q package -DskipTests

# 运行阶段
FROM eclipse-temurin:17-jre
WORKDIR /app
ENV TZ=Asia/Shanghai
COPY --from=build /app/target/*.jar app.jar
# 上传文件挂载到 /app/uploads（compose 中用命名卷持久化）
RUN mkdir -p /app/uploads
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS:--Xms128m -Xmx384m} -jar app.jar"]
