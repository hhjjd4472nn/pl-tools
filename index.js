/**
 * 链接解析助手 (pl-tools)
 * 网盘分享链接 -> 直链 -> 交给 Gopeed 多线程下载
 */

// ============ 站点配置 ============
var DP_HOST = "https://mf.dp.wpurl.cc";
var XL_HOST = "https://xl.wpurl.cc";
var KK_HOST = "https://kk.wpurl.cc";

var UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

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

// 统一解析站点的双层信封: {code:200, msg, data:{code:0, msg, ...}}
function unwrap(json) {
  if (!json || typeof json !== "object") throw new Error("响应为空");
  if (json.code !== 200 && json.code !== 0) {
    throw new Error(json.message || json.msg || "接口错误 code=" + json.code);
  }
  var d = json.data;
  if (d && typeof d === "object" && d.code !== undefined) {
    if (d.code !== 0) {
      throw new Error(d.msg || "解析失败 code=" + d.code);
    }
  }
  return d;
}

function detectShareType(url) {
  if (/pan\.baidu\.com/i.test(url)) return "baidu";
  if (/pan\.xunlei\.com/i.test(url)) return "xunlei";
  if (/pan\.quark\.cn/i.test(url)) return "quark";
  return "";
}

// 从链接中提取 surl / pwd_id 和提取码
function parseShareLink(url) {
  var out = { id: "", pwd: "" };
  var m;
  // 百度: /s/xxxx 或 ?surl=xxxx
  if (/pan\.baidu\.com/i.test(url)) {
    m = url.match(/\/s\/([A-Za-z0-9_\-]+)/);
    if (m) out.id = m[1];
    if (!out.id) {
      m = url.match(/[?&]surl=([A-Za-z0-9_\-]+)/);
      if (m) out.id = "1" + m[1];
    }
  }
  // 迅雷 / 夸克: /s/xxxx
  if (/pan\.xunlei\.com/i.test(url) || /pan\.quark\.cn/i.test(url)) {
    m = url.match(/\/s\/([A-Za-z0-9_\-]+)/);
    if (m) out.id = m[1];
  }
  // 提取码: ?pwd=xxx 或 &pwd=xxx 或 提取码:xxx
  m = url.match(/[?&]pwd=([A-Za-z0-9_\-]+)/);
  if (m) out.pwd = m[1];
  if (!out.pwd) {
    m = url.match(/(?:提取码|密码|pwd)[:：=]?\s*([A-Za-z0-9_\-]{2,10})/);
    if (m) out.pwd = m[1];
  }
  return out;
}

// ============ 百度网盘 (DP 站) ============
function baiduFileList(share, parsePassword) {
  var body = {
    url: "https://pan.baidu.com/s/" + share.id,
    surl: share.id,
    pwd: share.pwd || "",
    dir: "/",
    parse_password: parsePassword,
  };
  return httpJson(DP_HOST + "/api/v1/user/parse/get_file_list", "POST", body).then(
    function (j) {
      return unwrap(j);
    }
  );
}

function baiduDownloadLinks(share, fileList, parsePassword) {
  // 递归收集所有文件(非文件夹)，同时记录每个文件所在目录
  function collectFromList(list, currentDir) {
    var acc = [];
    var p = Promise.resolve();
    list.forEach(function (it) {
      if (!it || it.category === -1) return;
      p = p.then(function () {
        if (it.is_dir) {
          var subDir = it.path || (currentDir === "/" ? "/" + it.server_filename : currentDir + "/" + it.server_filename);
          return listDirRecursive(share, subDir, parsePassword).then(function (sub) {
            acc = acc.concat(sub);
          });
        }
        acc.push({ file: it, dir: currentDir });
        return null;
      });
    });
    return p.then(function () {
      return acc;
    });
  }

  function listDirRecursive(share2, dirPath, pw) {
    var body = {
      url: "https://pan.baidu.com/s/" + share2.id,
      surl: share2.id,
      pwd: share2.pwd || "",
      dir: dirPath,
      parse_password: pw,
    };
    return httpJson(DP_HOST + "/api/v1/user/parse/get_file_list", "POST", body)
      .then(function (j) {
        return unwrap(j);
      })
      .then(function (d) {
        return collectFromList((d && d.list) || [], dirPath);
      });
  }

  return collectFromList((fileList && fileList.list) || [], "/").then(function (all) {
    if (!all.length) throw new Error("该分享下没有可解析的文件");

    var out = [];
    var p = Promise.resolve();
    all.forEach(function (item) {
      p = p.then(function () {
        return getOneBaiduLink(share, item.file, parsePassword, item.dir)
          .then(function (one) {
            if (one && one.url) out.push(one);
          })
          .catch(function (e) {
            logErr("单个文件解析失败: " + (item.file.server_filename || "") + " -> " + e.message);
          });
      });
    });
    return p.then(function () {
      return out;
    });
  });
}

function getOneBaiduLink(share, file, parsePassword, fileDir) {
  // dir 必须是该文件所在的目录，站点用它来定位
  var dir = fileDir || "/";
  var body = {
    randsk: BAIDU_CTX.randsk,
    uk: BAIDU_CTX.uk,
    shareid: BAIDU_CTX.shareid,
    fs_id: [file.fs_id],
    download_folder: false,
    surl: share.id,
    dir: dir,
    pwd: share.pwd || "",
    token: "guest",
    parse_password: parsePassword,
    vcode_str: "",
    vcode_input: "",
  };

  return httpJson(DP_HOST + "/api/v1/user/parse/get_download_links", "POST", body)
    .then(function (j) {
      return unwrap(j);
    })
    .then(function (arr) {
      if (!arr || !arr.length) return null;
      var it = arr[0];
      return {
        name: it.filename || file.server_filename || ("file_" + file.fs_id),
        size: file.size || 0,
        url: it.url || (it.urls && it.urls[0]) || "",
        ua: it.ua || "",
      };
    });
}

var BAIDU_CTX = { randsk: "", uk: "", shareid: "" };

// ============ 主流程 ============
gopeed.events.onResolve(async function (ctx) {
  var url = ctx.req.url;
  var kind = detectShareType(url);
  logInfo("收到链接 type=" + kind + " url=" + url);

  if (!kind) {
    throw new Error("不支持的链接类型");
  }

  var share = parseShareLink(url);
  if (!share.id) {
    throw new Error("无法从链接中识别分享ID，请检查链接是否完整");
  }

  // ---- 百度 ----
  if (kind === "baidu") {
    var pw = getSetting("dp_password");
    if (!pw) {
      throw new Error("请先在扩展设置中填写【百度网盘解析密码】");
    }

    var fl = await baiduFileList(share, pw);
    // 缓存上下文
    BAIDU_CTX.randsk = (fl && fl.randsk) || "";
    BAIDU_CTX.uk = (fl && fl.uk) || "";
    BAIDU_CTX.shareid = (fl && fl.shareid) || "";

    var files = await baiduDownloadLinks(share, fl, pw);
    var okFiles = files.filter(function (f) {
      return f && f.url;
    });
    if (!okFiles.length) {
      throw new Error("解析完成但没有拿到有效直链");
    }

    ctx.res = {
      name: share.id,
      files: okFiles.map(function (f) {
        var req = { url: f.url };
        if (f.ua) {
          req.extra = { header: { "User-Agent": f.ua, Referer: "https://pan.baidu.com/" } };
        }
        return { name: f.name, size: f.size || 0, req: req };
      }),
    };
    logInfo("百度解析成功, 文件数=" + okFiles.length);
    return;
  }

  // ---- 迅雷 / 夸克 (后续版本) ----
  throw new Error(
    "该网盘暂未启用，当前版本仅支持百度网盘。请等待后续更新。"
  );
});
