// 全局缓存唯一WS连接
let globalSocket = null;

// WS推送工具函数
function sendToWSClient(data) {
  if (!globalSocket || globalSocket.readyState !== WebSocket.OPEN) return false;
  try {
    globalSocket.send(JSON.stringify({
      type: "form_data",
      data
    }));
    return true;
  } catch (err) {
    globalSocket = null;
    return false;
  }
}

// OPTIONS 统一预检处理
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

// 主路由分发：同时处理 /ws 和 /api/submit
export default async function onRequest({ request, env }) {
  const url = new URL(request.url);

  // ========== WebSocket 路由 /ws ==========
  if (url.pathname === "/ws") {
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade !== "websocket") {
      return Response.json({ code: 400, msg: "仅支持WebSocket连接" }, { status: 400 });
    }

    const [client, server] = new WebSocketPair();
    server.accept();

    // 新连接挤掉旧连接
    if (globalSocket) {
      try {
        globalSocket.close(1000, "新客户端接入，断开旧连接");
      } catch (e) {}
    }
    globalSocket = server;

    // 接收客户端普通业务消息
    server.addEventListener("message", (e) => {
      try {
        console.log("客户端消息：", e.data);
      } catch {}
    });

    // 断开时清空缓存
    server.addEventListener("close", () => {
      if (globalSocket === server) globalSocket = null;
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ========== 表单提交路由 /api/submit ==========
  if (url.pathname === "/api/submit") {
    // 非POST返回405
    if (request.method !== "POST") {
      return Response.json({ code: 405, msg: "仅允许POST提交表单" }, { status: 405 });
    }

    try {
      const body = await request.json();
      const { name, phone } = body;

      // 参数校验
      if (!name || !phone) {
        return Response.json({ code: 400, msg: "姓名和手机号不能为空" }, { status: 400 });
      }
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return Response.json({ code: 400, msg: "手机号格式错误" }, { status: 400 });
      }

      // 查询手机号是否已存在
      const existRes = await env.DB.prepare(
        "SELECT * FROM form_submit WHERE phone = ?"
      ).bind(phone).first();

      if (existRes) {
        return Response.json({
          code: 409,
          msg: "该手机号已提交过，请勿重复提交"
        }, { status: 409 });
      }

      // 写入数据库
      const now = new Date().toLocaleString();
      const submitData = { name, phone, time: now };
      await env.DB.prepare(
        "INSERT INTO form_submit (name, phone, create_time) VALUES (?, ?, ?)"
      ).bind(name, phone, now).run();

      // 推送数据到WS客户端
      sendToWSClient(submitData);

      return Response.json({
        code: 200,
        msg: "提交成功",
        data: submitData
      });

    } catch (err) {
      console.error("提交异常：", err);
      return Response.json({ code: 500, msg: "服务器异常，提交失败" }, { status: 500 });
    }
  }

  // 其他路径404
  return Response.json({ code: 404, msg: "接口不存在" }, { status: 404 });
}
