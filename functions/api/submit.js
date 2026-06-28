// 全局唯一WS连接（同Worker实例内存共享）
let globalSocket = null;

// 推送消息到WS客户端
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

// 统一处理OPTIONS预检
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

// POST 表单提交逻辑
async function handleSubmit(request, env) {
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

    // 推送给在线WS
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

// WebSocket握手处理
async function handleWS(request) {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
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

  // 接收客户端普通消息（底层协议ping/pong自动处理）
  server.addEventListener("message", (e) => {
    try {
      console.log("客户端消息：", e.data);
    } catch {}
  });

  // 断开清空缓存
  server.addEventListener("close", () => {
    if (globalSocket === server) globalSocket = null;
  });

  return new Response(null, { status: 101, webSocket: client });
}

// 主入口分发所有请求
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname;

  // WebSocket路由 /wss
  if (path === "/wss") {
    return handleWS(request);
  }

  // 表单提交路由 /api/submit
  if (path === "/api/submit") {
    if (request.method !== "POST") {
      return Response.json({ code: 405, msg: "仅允许POST提交表单" }, { status: 405 });
    }
    return handleSubmit(request, env);
  }

  // 其他路径交给静态资源（public文件夹）
  return env.ASSETS.fetch(request);
}
