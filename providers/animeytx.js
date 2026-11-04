// AnimeYTX v1.0.0 — animeytx.org (anime sub español / latino)
// Chain (all plain HTTP, no login):
//   /                              -> home: "Animes recientes" cards
//   /catalogo?buscar=<q>            -> search cards (./anime/<slug>)
//   /anime/<slug>                   -> h1 title, og:image, meta description,
//                                      var eps=[["1","title"],...], data-sl
//   /ver/<sl>-<ep>                  -> watch page, data-encrypt="<hex>"
//   POST /yt  acc=opt&i=<hex>       -> <li encrypt="<hex>" data="<embed page>"
//                                      title="Opción N, <server>">
//   mp4upload embed page            -> src: "https://.../video.mp4" (direct mp4)
// Only MP4Upload is resolvable with plain HTTP (same pattern as the
// Latin repo's AnimeJL source); filemoon/streamwish/dhcplay embeds need
// JS/browser and are skipped. Playback needs the app to forward the
// entry headers (Referer = embed page) — mp4upload 403s without it.
//
// ES5 only. The app runtime lacks atob/btoa/Buffer — pure-JS hex decode below.

var BASE = 'https://animeytx.org';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeYTX', lang: 'es', baseUrl: BASE,
           logo: BASE + '/favicon.ico', type: 'anime', version: '1.0.1' };
}

function _withTimeout(promise, ms, label) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  var t;
  var timeout = new Promise(function (_, reject) {
    t = setTimeout(function () { reject(new Error('timeout: ' + label)); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  }, function (e) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e2) {}
    throw e;
  });
}

function _getText(url, headers) {
  var h = { 'User-Agent': UA };
  if (headers) {
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) h[k] = headers[k];
    }
  }
  var p = fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
  return _withTimeout(p, 20000, 'GET ' + url);
}

function _postText(url, body, headers) {
  var h = { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (headers) {
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) h[k] = headers[k];
    }
  }
  // body must stay a STRING: the app fetch bridge JSON.stringifies objects.
  var p = fetch(url, { method: 'POST', headers: h, body: String(body) }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
  return _withTimeout(p, 20000, 'POST ' + url);
}

function _hex2a(hex) {
  var s = String(hex || ''), out = '';
  for (var i = 0; i + 1 < s.length; i += 2) {
    out += String.fromCharCode(parseInt(s.substr(i, 2), 16));
  }
  return out;
}

function _abs(href) {
  href = String(href || '');
  if (/^https?:\/\//i.test(href)) return href;
  if (href.charAt(0) === '/') return BASE + href;
  if (href.indexOf('./') === 0) return BASE + '/' + href.slice(2);
  return BASE + '/' + href;
}

function _clean(s) {
  return String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}

// <article class="li"> ... <a href="./anime/<slug>" ...><img data-src="<cover>" alt="<title>">
function _parseCards(html) {
  var items = [], seen = {}, re = /<article class="li">([\s\S]*?)<\/article>/g, m;
  while ((m = re.exec(html)) !== null) {
    var card = m[1];
    var lm = /<a[^>]*href="([^"]*\/anime\/[a-z0-9-]+)"[^>]*>/i.exec(card);
    if (!lm) continue;
    var url = _abs(lm[1]);
    if (seen[url]) continue;
    seen[url] = 1;
    var slug = /\/anime\/([a-z0-9-]+)/i.exec(url)[1];
    var im = /data-src="([^"]+)"/i.exec(card) || /<img[^>]*src="([^"]+)"/i.exec(card);
    var tm = /alt="([^"]+)"/i.exec(card) || /<h3[^>]*>\s*<a[^>]*>([^<]+)</i.exec(card);
    items.push({ id: slug, title: _clean(tm ? tm[1] : slug), cover: im ? _abs(im[1]) : null,
                 type: 'anime', url: url });
  }
  return items;
}

function getHome() {
  return _getText(BASE + '/').then(function (t) {
    var i = t.indexOf('Animes recientes');
    var seg = i === -1 ? t : t.slice(i, i + 40000);
    var items = _parseCards(seg);
    if (!items.length) throw new Error('home: no cards found');
    return [{ title: 'Animes recientes', items: items }];
  });
}

function search(q) {
  q = String(q || '').replace(/^\s+|\s+$/g, '');
  if (!q) return Promise.resolve([]);
  return _getText(BASE + '/catalogo?buscar=' + encodeURIComponent(q)).then(function (t) {
    return _parseCards(t);
  });
}

function _parseDetail(html, url) {
  var tm = /<h1[^>]*>([^<]+)</i.exec(html);
  var title = _clean(tm ? tm[1] : '');
  var cm = /<meta property="og:image" content="([^"]+)"/i.exec(html);
  var dm = /<meta name="description" content="([^"]+)"/i.exec(html);
  var sm = /data-sl="([^"]+)"/i.exec(html);
  var sl = sm ? sm[1] : null;
  var eps = [];
  var em = /var eps = (\[[\s\S]*?\]);/.exec(html);
  if (em) {
    try {
      var arr = JSON.parse(em[1]);
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i][0]) eps.push({ num: String(arr[i][0]), name: String(arr[i][1] || '') });
      }
    } catch (e) { /* fall through */ }
  }
  return { title: title, sl: sl, eps: eps,
           cover: cm ? cm[1] : null,
           description: dm ? _clean(dm[1]) : null, url: url };
}

function getDetail(url) {
  return _getText(url).then(function (t) {
    var d = _parseDetail(t, url);
    if (!d.title) throw new Error('detail: no title');
    return { id: url, title: d.title, cover: d.cover, description: d.description,
             type: 'anime', url: url };
  });
}

function getEpisodes(detailUrl) {
  return _getText(detailUrl).then(function (t) {
    var d = _parseDetail(t, detailUrl);
    if (!d.sl) throw new Error('episodes: no data-sl');
    if (!d.eps.length) throw new Error('episodes: empty list');
    var eps = [];
    for (var i = 0; i < d.eps.length; i++) {
      var n = parseFloat(d.eps[i].num);
      if (isNaN(n)) continue;
      var epUrl = BASE + '/ver/' + d.sl + '-' + d.eps[i].num;
      // id is REQUIRED by the app's Episode decoder (json['id'] as String
      // throws the whole episode list when missing) — v1.0.0 omitted it.
      eps.push({ id: 'animeytx:' + d.sl + '-' + d.eps[i].num,
                 number: n,
                 title: 'Episodio ' + d.eps[i].num + (d.eps[i].name ? ' — ' + d.eps[i].name : ''),
                 url: epUrl });
    }
    if (!eps.length) throw new Error('episodes: no numeric episodes');
    return eps;
  });
}

function _parseOptions(html) {
  var opts = [], re = /<li\b[^>]*>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var tag = m[0];
    var enc = /encrypt="([0-9a-f]+)"/i.exec(tag);
    var dat = /\bdata="([^"]+)"/i.exec(tag);
    var tit = /title="([^"]*)"/i.exec(tag);
    if (!enc) continue;
    opts.push({ embed: _hex2a(enc[1]), page: dat ? dat[1] : null,
                label: tit ? _clean(tit[1]) : '' });
  }
  return opts;
}

function getVideoSources(episodeUrl) {
  return _getText(episodeUrl).then(function (t) {
    var kind = /latino|castellano/i.test(t) ? 'dub' : 'sub';
    var km = /data-encrypt="([0-9a-f]+)"/i.exec(t);
    if (!km) throw new Error('no data-encrypt on watch page');
    return _postText(BASE + '/yt', 'acc=opt&i=' + km[1],
      { 'X-Requested-With': 'XMLHttpRequest', 'Referer': episodeUrl }
    ).then(function (ot) {
      var opts = _parseOptions(ot);
      var mp4s = [];
      for (var i = 0; i < opts.length; i++) {
        if (/mp4upload\.com/i.test(opts[i].embed) && mp4s.indexOf(opts[i].embed) === -1) {
          mp4s.push(opts[i].embed);
        }
      }
      if (!mp4s.length) throw new Error('no MP4Upload server on this episode page');
      var label = '[MP4Upload] ' + (kind === 'dub' ? 'Latino' : 'Sub Español');
      var chain = Promise.resolve([]);
      mp4s.forEach(function (embedUrl) {
        chain = chain.then(function (acc) {
          return _getText(embedUrl, { Referer: episodeUrl }).then(function (et) {
            var sm = /src:\s*"(https:[^"]*mp4upload[^"]*\/video\.mp4)"/.exec(et);
            if (sm) {
              acc.push({ url: sm[1], label: label, container: 'mp4', kind: kind,
                         headers: { Referer: embedUrl, 'User-Agent': UA } });
            }
            return acc;
          }, function () { return acc; });
        });
      });
      return chain.then(function (acc) {
        if (!acc.length) throw new Error('MP4Upload embeds yielded no playable URL');
        return acc;
      });
    });
  });
}
