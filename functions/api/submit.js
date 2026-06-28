// 处理OPTIONS预检，解决405
export async function onRequestOptions() {
  return new Response(null, {
    status: 204
  });
}

// 只处理POST提交
export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const { name, phone } = body;

    if (!name || !phone) {
      return Response.json({ code: 400, msg: "姓名和手机号不能为空" }, { status: 400 });
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return Response.json({ code: 400, msg: "手机号格式错误" }, { status: 400 });
    }

    const submitData = {
      name,
      phone,
      time: new Date().toLocaleString()
    };

    return Response.json({
      code: 200,
      msg: "提交成功",
      data: submitData
    });
  } catch (err) {
    return Response.json({ code: 500, msg: "请求必须为JSON" }, { status: 500 });
  }
}

// 拦截GET/HEAD/PUT/DELETE等所有其他方法，返回405
export async function onRequest() {
  return Response.json({ code: 405, msg: "仅允许POST提交表单" }, { status: 405 });
}
