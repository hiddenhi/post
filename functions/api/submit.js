// 全局缓存唯一WS长连接
let globalSocket = null;

/** 推送数据给WS客户端（完全隔离异常，不干扰表单入库） */
function sendToWSClient(data) {
  // 双重判断连接状态
  if (!globalSocket || globalSocket.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    const payload = JSON.stringify({
      type: "form_data",
      data
    });
    globalSocket.send(payload);
    return true;
  } catch (err) {
    console.warn("WS推送失败，连接失效：", err.message);
    // 连接异常直接清空，下次不再尝试
    globalSocket = null;
    return false;
  }
}

// 处理OPTIONS预检，解决405
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Upgrade"
    }
  });
}

// 只处理POST提交：入库优先，WS推送失败不影响返回成功
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

    const now = new Date().toLocaleString();
    const submitData = {
      name,
      phone,
      time: now
    };

    // 数据库操作优先执行，完全独立不受WS影响
    const res = await env.DB.prepare(`
      INSERT OR IGNORE INTO form_submit (name, phone, create_time)
      VALUES (?, ?, ?)
    `).bind(name, phone, now).run();

    if (res.meta.changes === 0) {
      return Response.json({
        code: 409,
        msg: "该手机号已提交过，请勿重复提交"
      }, { status: 409 });
    }

    // 数据库插入成功后，单独执行WS推送，失败也不抛异常
    sendToWSClient(submitData);

    return Response.json({
      code: 200,
      msg: "提交成功",
      data: submitData
    });
  } catch (bizErr) {
    console.error("数据库完整异常：", bizErr);
    return Response.json({ code: 500, msg: "数据库操作失败" }, { status: 500 });
  }
}

// GET 升级WebSocket
export async function onRequest({ request }) {
  const method = request.method;
  const upgradeHeader = request.headers.get("Upgrade");

  if (method === "GET" && upgradeHeader === "websocket") {
    const [client, server] = new WebSocketPair();
    server.accept();

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
