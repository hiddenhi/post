// 处理OPTIONS预检，解决405
export async function onRequestOptions() {
  return new Response(null, {
    status: 204
  });
}

// 只处理POST提交
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

    // 1. 查询手机号是否存在
    const existRes = await env.DB.prepare(
      "SELECT * FROM form_submit WHERE phone = ?"
    ).bind(phone).first();

    if (existRes) {
      return Response.json({
        code: 409,
        msg: "该手机号已提交过，请勿重复提交"
      }, { status: 409 });
    }

    // 2. 写入数据库
    const now = new Date().toLocaleString();
    const submitData = { name, phone, time: now };
    await env.DB.prepare(
      "INSERT INTO form_submit (name, phone, create_time) VALUES (?, ?, ?)"
    ).bind(name, phone, now).run();

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

// 拦截GET/HEAD/PUT/DELETE等所有其他方法，返回405
export async function onRequest() {
  return Response.json({ code: 405, msg: "仅允许POST提交表单" }, { status: 405 });
}
