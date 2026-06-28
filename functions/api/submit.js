// 全局缓存唯一WS长连接（仅当POST/GET复用同一个Worker实例时生效）
let globalSocket = null;

/** 推送数据给WS客户端，内部捕获全部异常，不向上抛出 */
function sendToWSClient(data) {
  // 双重校验连接状态
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
    // 清理失效句柄，避免后续重复报错
    globalSocket = null;
    return false;
  }
}

// 处理OPTIONS跨域预检，补充跨域头防止请求中断
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

// POST表单提交逻辑：数据库操作优先，WS推送异步隔离不影响主流程
export async function onRequestPost({ request, env }) {
  // 单独捕获JSON解析错误，和业务错误分层
  let body;
  try {
    body = await request.json();
  } catch (parseErr) {
    console.error("JSON解析异常：", parseErr);
    return Response.json({ code: 400, msg: "请求体不是合法JSON" }, { status: 400 });
  }

  try {
    const { name, phone } = body;

    // 基础字段校验
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

    // 原子插入，规避并发唯一约束报错
    const insertResult = await env.DB.prepare(`
      INSERT OR IGNORE INTO form_submit (name, phone, create_time)
      VALUES (?, ?, ?)
    `).bind(name, phone, now).run();

    // 插入行数0 = 手机号已存在
    if (insertResult.meta.changes === 0) {
      return Response.json({
        code: 409,
        msg: "该手机号已提交过，请勿重复提交"
      }, { status: 409 });
    }

    // 使用微任务异步执行WS推送，主流程先返回成功，WS异常不会污染业务
    queueMicrotask(() => {
      try {
        sendToWSClient(submitData);
      } catch (sendErr) {
        console.warn("异步WS发送捕获异常，不影响表单提交：", sendErr.message);
      }
    });

    // 直接返回成功，不受WS连接状态影响
    return Response.json({
      code: 200,
      msg: "提交成功",
      data: submitData
    });

  } catch (bizErr) {
    console.error("数据库操作底层异常：", bizErr);
    return Response.json({ code: 500, msg: "数据库操作失败" }, { status: 500 });
  }
}

// 处理GET请求：携带Upgrade头则升级WebSocket，其余方法返回405
export async function onRequest({ request }) {
  const method = request.method;
  const upgradeHeader = request.headers.get("Upgrade");

  // GET + Upgrade: websocket 建立长连接
  if (method === "GET" && upgradeHeader === "websocket") {
    const [client, server] = new WebSocketPair();
    server.accept();

    // 新连接覆盖并关闭旧连接
    if (globalSocket) {
      try {
        globalSocket.close(1000, "新客户端接入，断开旧连接");
      } catch (e) {}
    }
    globalSocket = server;

    // 接收客户端普通消息（底层协议ping/pong自动处理）
    server.addEventListener("message", (e) => {
      try {
        console.log("客户端WS消息：", e.data);
      } catch {}
    });

    // 客户端断开时清空全局句柄
    server.addEventListener("close", () => {
      if (globalSocket === server) {
        globalSocket = null;
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // 不满足WS升级条件的请求全部返回405
  return Response.json(
    { code: 405, msg: "仅允许POST提交表单，GET仅支持WebSocket升级连接" },
    { status: 405 }
  );
}
