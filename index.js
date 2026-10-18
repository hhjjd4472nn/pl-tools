/**
 * 链接解析助手 (pl-tools)
 * 网盘分享链接 -> 直链 -> 交给 Gopeed 多线程下载
 */

// ============ 站点配置 ============
var DP_HOST = "https://mf.dp.wpurl.cc";

var UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

// 重试配置：站点有限流，连续请求会偶发失败
var RETRY_MAX = 4;
var RETRY_DELAY = 1200;

// ============ 工具函数 ============
function logInfo(m) {
  try {
    gopeed.logger.info("[pl-tools] " + m);
  } catch (e) {}
}
function logErr(m) {
  try {
    gopeed.logger.error("[pl-tools] " + m);
  } catch (e) {}
}

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

function getSetting(name) {
  try {
    var v = gopeed.settings[name];
    if (v === undefined || v === null) return "";
    return String(v).trim();
  } catch (e) {
    return "";
  }
}

function httpJson(url, method, body) {
  var opt = {
    method: method || "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": UA_MOBILE,
    },
  };
  if (body !== undefined && body !== null) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  return fetch(url, opt).then(function (r) {
    return r.text().then(function (txt) {
      var json;
      try {
        json = JSON.parse(txt);
      } catch (e) {
        throw new Error("接口返回非 JSON: " + String(txt).slice(0, 120));
      }
      return json;
    });
  });
}

// 带重试的请求（应对站点限流）
async function httpJsonRetry(url, method, body, label) {
  var lastErr = null;
  for (var i = 0; i < RETRY_MAX; i++) {
    try {
      var json = await httpJson(url, method, body);
      var msg =
        (json && (json.message || json.msg || (json.data && json.data.msg))) || "";
      msg = String(msg);
      var isThrottle =
        /请求失败|限流|频繁|稍后|too many/i.test(msg) &&
        !/解析密码|密码.*正确/i.test(msg);
      if (isThrottle && i < RETRY_MAX - 1) {
        logInfo((label || "") + " 限流，第 " + (i + 1) + " 次重试...");
        await sleep(RETRY_DELAY * (i + 1));
        continue;
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (i < RETRY_MAX - 1) {
        logInfo((label || "") + " 请求异常，重试: " + e.message);
        await sleep(RETRY_DELAY * (i + 1));
      }
    }
  }
  if (lastErr) throw lastErr;
  throw new Error((label || "请求") + " 重试 " + RETRY_MAX + " 次仍失败");
}

// 统一解析站点的双层信封
function unwrap(json) {
  if (!json || typeof json !== "object") throw new Error("响应为空");
  if (json.code !== 200 && json.code !== 0) {
    throw new Error(json.message || json.msg || "接口错误 code=" + json.code);
  }
  var d = json.data;
  if (d && typeof d === "object" && !Array.isArray(d) && d.code !== undefined) {
    if (d.code !== 0) {
      throw new Error(d.msg || "解析失败 code=" + d.code);
    }
  }
  return d;
}

/**
 * 核心：从任意文本中提取网盘分享链接
 * 支持直接粘贴整段分享文字
 */
function extractShareUrl(text) {
  if (!text) return "";
  var s = String(text);

  var patterns = [
    /https?:\/\/pan\.baidu\.com\/share\/init\?surl=[A-Za-z0-9_\-]+(?:\?[^\s"'<>）)】\]]*)?/i,
    /https?:\/\/pan\.baidu\.com\/s\/[A-Za-z0-9_\-]+(?:\?[^\s"'<>）)】\]]*)?/i,
    /https?:\/\/pan\.xunlei\.com\/s\/[A-Za-z0-9_\-]+(?:\?[^\s"'<>）)】\]]*)?/i,
    /https?:\/\/pan\.quark\.cn\/s\/[A-Za-z0-9_\-]+(?:\?[^\s"'<>）)】\]]*)?/i,
  ];

  for (var i = 0; i < patterns.length; i++) {
    var m = s.match(patterns[i]);
    if (m) return m[0].replace(/[，。；、！？\s]+$/, "");
  }

  var m2 = s.match(
    /pan\.(?:baidu\.com\/s|quark\.cn\/s|xunlei\.com\/s)\/[A-Za-z0-9_\-]+(?:\?[^\s"'<>）)】\]]*)?/i
  );
  if (m2) return "https://" + m2[0].replace(/[，。；、！？\s]+$/, "");

  return "";
}

function detectShareType(url) {
  if (/pan\.baidu\.com/i.test(url)) return "baidu";
  if (/pan\.xunlei\.com/i.test(url)) return "xunlei";
  if (/pan\.quark\.cn/i.test(url)) return "quark";
  return "";
}

function parseShareLink(url) {
  var out = { id: "", pwd: "" };
  var m;
  if (/pan\.baidu\.com/i.test(url)) {
    m = url.match(/\/s\/([A-Za-z0-9_\-]+)/);
    if (m) out.id = m[1];
    if (!out.id) {
      m = url.match(/[?&]surl=([A-Za-z0-9_\-]+)/);
      if (m) out.id = "1" + m[1];
    }
  }
  if (/pan\.xunlei\.com/i.test(url) || /pan\.quark\.cn/i.test(url)) {
    m = url.match(/\/s\/([A-Za-z0-9_\-]+)/);
    if (m) out.id = m[1];
  }
  m = url.match(/[?&]pwd=([A-Za-z0-9_\-]+)/);
  if (m) out.pwd = m[1];
  if (!out.pwd) {
    m = url.match(/(?:提取码|访问码|密码|pwd)\s*[:：=]\s*([A-Za-z0-9_\-]{2,12})/);
    if (m) out.pwd = m[1];
  }
  return out;
}

function extractPwdFromText(text, link) {
  if (!text) return "";
  var s = String(text);
  if (link) s = s.split(link).join(" ");
  var m = s.match(/(?:提取码|访问码|密码|pwd)\s*[:：=]?\s*([A-Za-z0-9]{2,12})/);
  return m ? m[1] : "";
}

// ============ 百度网盘 (DP 站) ============
var BAIDU_CTX = { randsk: "", uk: "", shareid: "" };

function baiduFileList(share, parsePassword) {
  var body = {
    url: "https://pan.baidu.com/s/" + share.id,
    surl: share.id,
    pwd: share.pwd || "",
    dir: "/",
    parse_password: parsePassword,
  };
  return httpJsonRetry(
    DP_HOST + "/api/v1/user/parse/get_file_list",
    "POST",
    body,
    "获取文件列表"
  ).then(function (j) {
    return unwrap(j);
  });
}

function baiduListDir(share, dirPath, parsePassword) {
  var body = {
    url: "https://pan.baidu.com/s/" + share.id,
    surl: share.id,
    pwd: share.pwd || "",
    dir: dirPath,
    parse_password: parsePassword,
  };
  return httpJsonRetry(
    DP_HOST + "/api/v1/user/parse/get_file_list",
    "POST",
    body,
    "列出目录 " + dirPath
  ).then(function (j) {
    return unwrap(j);
  });
}

async function baiduCollectAll(share, list, currentDir, parsePassword) {
  var acc = [];
  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    if (!it || it.category === -1) continue;
    if (it.is_dir) {
      var subDir =
        it.path ||
        (currentDir === "/"
          ? "/" + it.server_filename
          : currentDir + "/" + it.server_filename);
      var d = await baiduListDir(share, subDir, parsePassword);
      var sub = await baiduCollectAll(
        share,
        (d && d.list) || [],
        subDir,
        parsePassword
      );
      acc = acc.concat(sub);
    } else {
      acc.push({ file: it, dir: currentDir });
    }
  }
  return acc;
}

// 关键修复：接口返回字段是 urls 数组，不是 url
function getOneBaiduLink(share, file, parsePassword, fileDir) {
  var body = {
    randsk: BAIDU_CTX.randsk,
    uk: BAIDU_CTX.uk,
    shareid: BAIDU_CTX.shareid,
    fs_id: [file.fs_id],
    download_folder: false,
    surl: share.id,
    dir: fileDir || "/",
    pwd: share.pwd || "",
    token: "guest",
    parse_password: parsePassword,
    vcode_str: "",
    vcode_input: "",
  };

  return httpJsonRetry(
    DP_HOST + "/api/v1/user/parse/get_download_links",
    "POST",
    body,
    "获取直链 " + (file.server_filename || "")
  )
    .then(function (j) {
      return unwrap(j);
    })
    .then(function (arr) {
      if (!arr) return null;
      var list = Array.isArray(arr) ? arr : [arr];
      if (!list.length) return null;
      var it = list[0];

      var dlUrl = "";
      if (it.urls && it.urls.length) {
        dlUrl = it.urls[0];
      } else if (it.url) {
        dlUrl = it.url;
      } else if (it.dlink) {
        dlUrl = it.dlink;
      }
      if (!dlUrl) return null;

      return {
        name: it.filename || file.server_filename || "file_" + file.fs_id,
        size: file.size || 0,
        url: dlUrl,
        ua: it.ua || "",
      };
    });
}

// ============ 主流程 ============
gopeed.events.onResolve(async function (ctx) {
  var raw = ctx.req.url;
  logInfo("收到原始输入: " + String(raw).slice(0, 200));

  var url = extractShareUrl(raw);
  if (!url) {
    if (/^https?:\/\//i.test(String(raw).trim())) {
      url = String(raw).trim();
    } else {
      throw new Error(
        "没有在内容里找到网盘分享链接。请粘贴百度网盘/夸克/迅雷的分享链接（可连同整段分享文字一起粘贴）"
      );
    }
  }
  logInfo("提取到链接: " + url);

  var kind = detectShareType(url);
  if (!kind) {
    throw new Error("暂不支持该网盘，目前支持：百度网盘、夸克网盘、迅雷网盘");
  }

  var share = parseShareLink(url);
  if (!share.id) {
    throw new Error("无法从链接中识别分享ID，请检查链接是否完整");
  }
  if (!share.pwd) {
    var p2 = extractPwdFromText(raw, url);
    if (p2) share.pwd = p2;
  }
  logInfo("分享ID=" + share.id + " 提取码=" + (share.pwd || "(无)"));

  if (kind === "baidu") {
    var pw = getSetting("dp_password");
    if (!pw) {
      throw new Error("请先在扩展设置中填写【百度网盘解析密码】");
    }

    var fl = await baiduFileList(share, pw);
    BAIDU_CTX.randsk = (fl && fl.randsk) || "";
    BAIDU_CTX.uk = (fl && fl.uk) || "";
    BAIDU_CTX.shareid = (fl && fl.shareid) || "";

    var list = (fl && fl.list) || [];
    if (!list.length) {
      throw new Error("该分享下没有文件，或提取码不正确");
    }

    var all = await baiduCollectAll(share, list, "/", pw);
    if (!all.length) {
      throw new Error("该分享下没有可解析的文件");
    }
    logInfo("共发现 " + all.length + " 个文件，开始获取直链");

    var out = [];
    for (var i = 0; i < all.length; i++) {
      var item = all[i];
      try {
        var one = await getOneBaiduLink(share, item.file, pw, item.dir);
        if (one && one.url) {
          out.push(one);
          logInfo("OK " + one.name + " (" + one.size + " B)");
        } else {
          logErr("未取到直链: " + (item.file.server_filename || ""));
        }
      } catch (e) {
        logErr((item.file.server_filename || "") + " -> " + e.message);
      }
      if (i < all.length - 1) await sleep(600);
    }

    if (!out.length) {
      throw new Error(
        "解析完成但没有拿到有效直链，可能是解析密码已过期或站点限流，请稍后重试"
      );
    }

    ctx.res = {
      name: out.length === 1 ? out[0].name : share.id,
      files: out.map(function (f) {
        var req = { url: f.url };
        var hd = { Referer: "https://pan.baidu.com/" };
        if (f.ua) hd["User-Agent"] = f.ua;
        req.extra = { header: hd };
        return { name: f.name, size: f.size || 0, req: req };
      }),
    };
    logInfo("百度解析成功，文件数=" + out.length);
    return;
  }

  throw new Error("该网盘暂未启用，当前版本仅支持百度网盘。请等待后续更新。");
});