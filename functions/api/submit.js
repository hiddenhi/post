// 全局缓存唯一WS长连接
let globalSocket = null;

/** 推送数据给WS客户端 */
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

// OPTIONS 预检统一处理（表单跨域/WS升级预检共用）
export async function onRequestOptions() {
  return new Response(null, {
    status: 204
  });
}

// POST 表单提交接口：入库 + 推送WS
export async function onRequestPost({ request, env }) {
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

    // D1查重
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

    // 推送给在线WS客户端
    sendToWSClient(submitData);

    return Response.json({
      code: 200,
      msg: "提交成功",
      data: submitData
    });
  } catch (err) {
    console.error(err);
    return Response.json({ code: 500, msg: "请求必须为JSON" }, { status: 500 });
  }
}

// 统一入口：处理WS升级请求 / 拦截非法请求方法
export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  // 路径 /ws 处理WebSocket握手
  if (url.pathname === "/wss") {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader !== "websocket") {
      return Response.json({ code: 400, msg: "仅支持WebSocket连接" }, { status: 400 });
    }

    const [client, server] = new WebSocketPair();
    server.accept();

    // 新连接覆盖并关闭旧连接
    if (globalSocket) {
      try {
        globalSocket.close(1000, "新客户端接入，断开旧连接");
      } catch (e) {}
    }
    globalSocket = server;

    // 监听客户端普通消息（原生协议ping/pong自动处理，无需代码）
    server.addEventListener("message", (e) => {
      try {
        console.log("客户端消息：", e.data);
      } catch {}
    });

    // 连接断开清空全局缓存
    server.addEventListener("close", () => {
      if (globalSocket === server) globalSocket = null;
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // 路径 /api/submit 非POST请求返回405
  if (url.pathname === "/api/submit") {
    return Response.json({ code: 405, msg: "仅允许POST提交表单" }, { status: 405 });
  }

  // 其他路径404
  return Response.json({ code: 404, msg: "接口不存在" }, { status: 404 });
}
