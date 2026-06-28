// 全局缓存唯一WS长连接
let globalSocket = null;

/** 推送数据给WS客户端，内部捕获全部异常，不向上抛出 */
function sendToWSClient(data) {
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
  } catch (err)
    console.warn("WS推送失败，连接已失效：", err.message);
    globalSocket = null;
    return false;
  }
}

// OPTIONS跨域预检
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

// POST提交接口
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (parseErr) {
    console.error("JSON解析异常：", parseErr);
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

    const insertResult = await env.DB.prepare(`
      INSERT OR IGNORE INTO form_submit (name, phone, create_time)
      VALUES (?, ?, ?)
    `).bind(name, phone, now).run();

    if (insertResult.meta.changes === 0) {
      return Response.json({
        code: 409,
        msg: "该手机号已提交过，请勿重复提交"
      }, { status: 409 });
    }

    // 异步微任务发送WS，隔离异常
    queueMicrotask(function() {
      try {
        sendToWSClient(submitData);
      } catch (sendErr) {
        console.warn("异步WS发送异常：", sendErr.message);
      }
    });

    return Response.json({
      code: 200,
      msg: "提交成功",
      data: submitData
    });

  } catch (bizErr) {
    console.error("数据库底层异常：", bizErr);
    return Response.json({ code: 500, msg: "数据库操作失败" }, { status: 500 });
  }
}

// GET处理WS升级，其他方法405
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

    server.addEventListener("message", function(e) {
      try {
        console.log("客户端消息：", e.data);
      } catch {}
    });

    server.addEventListener("close", function() {
      if (globalSocket === server) {
        globalSocket = null;
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  return Response.json(
    { code: 405, msg: "仅允许POST提交表单，GET仅支持WebSocket升级连接" },
    { status: 405 }
  );
}
