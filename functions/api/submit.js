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

// 处理OPTIONS预检，解决405
export async function onRequestOptions() {
  return new Response(null, {
    status: 204
  });
}

// 只处理POST提交：入库 + 推送WS
export async function onRequestPost({ request, env }) {
  // 第一层：单独捕获JSON解析错误
  let body;
  try {
    body = await request.json();
  } catch (parseErr) {
    console.error("JSON解析错误：", parseErr);
    return Response.json({ code: 400, msg: "请求体不是合法JSON" }, { status: 400 });
  }

  try {
    const { name, phone } = body;

    if (!name || !phone) {
      return Response.json({ code: 400, msg: "姓名和手机号不能为空" }, { status: 400 });
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return Response.json({ code: 400, msg: "手机号格式错误" }, { status: 400 });
    }

    // D1 数据库查重
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
    const submitData = {
      name,
      phone,
      time: now
    };
    await env.DB.prepare(
      "INSERT INTO form_submit (name, phone, create_time) VALUES (?, ?, ?)"
    ).bind(name, phone, now).run();

    // 有在线WS客户端则推送数据
    //sendToWSClient(submitData);

    return Response.json({
      code: 200,
      msg: "提交成功",
      data: submitData
    });
  } catch (bizErr) {
    // 第二层：数据库/业务逻辑报错
    console.error("业务/数据库异常：", bizErr);
    return Response.json({ code: 500, msg: "数据库操作失败" }, { status: 500 });
  }
}

// 拦截GET/HEAD/PUT/DELETE等所有其他方法
export async function onRequest({ request }) {
  const method = request.method;
  const upgradeHeader = request.headers.get("Upgrade");

  // GET 请求 + WebSocket升级头 → 创建WS长连接
  if (method === "GET" && upgradeHeader === "websocket") {
    const [client, server] = new WebSocketPair();
    server.accept();

    // 新连接挤掉旧连接
    if (globalSocket) {
      try {
        globalSocket.close(1000, "新客户端接入，断开旧连接");
      } catch (e) {}
    }
    globalSocket = server;

    server.addEventListener("message", (e) => {
      try {
        console.log("客户端消息：", e.data);
      } catch {}
    });

    server.addEventListener("close", () => {
      if (globalSocket === server) globalSocket = null;
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  return Response.json({ code: 405, msg: "仅允许POST提交表单，GET仅支持WebSocket升级连接" }, { status: 405 });
}
