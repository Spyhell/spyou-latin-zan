// AnimeJL v1.0.0 — anime-jl.net (anime latino / castellano)
// Chain: /animes?q= -> /anime/<id>/<slug> (anime_info + episodes JS vars)
// -> /anime/<id>/<slug>/episodio-<N> (video[] iframe array)
// -> MP4Upload embed -> direct mp4 (verified playable).
// Note: the site's player UI gates some servers behind a VIP modal, but the
// embed URLs themselves resolve fine with plain HTTP, so they are fetched
// directly. Dubs are separate anime entries (latino/castellano), surfaced
// as-is per the multi-audio preference.

var BASE = 'https://www.anime-jl.net';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeJL', lang: 'es', baseUrl: BASE,
           logo: BASE + '/favicon.ico', type: 'anime', version: '1.0.0' };
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

function _stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function _absUrl(href) {
  href = String(href || '');
  if (/^https?:\/\//i.test(href)) return href;
  if (href.charAt(0) === '/') return BASE + href;
  return BASE + '/' + href;
}

// <article class='Anime alt B'> cards (search + catalog share the markup)
function _parseCards(html) {
  var out = [];
  var parts = String(html || '').split('<article');
  for (var i = 1; i < parts.length; i++) {
    var c = parts[i];
    var hm = /<a[^>]+href='([^']+)'/.exec(c) || /<a[^>]+href="([^"]+)"/.exec(c);
    if (!hm) continue;
    var href = _absUrl(hm[1]);
    if (!/\/anime\/\d+\//.test(href)) continue;
    var tm = /<h3[^>]*>([^<]+)<\/h3>/.exec(c);
    var im = /<img[^>]+src='([^']+)'/.exec(c) || /<img[^>]+src="([^"]+)"/.exec(c);
    var title = tm ? tm[1].trim() : href;
    out.push({ id: 'animejl:' + href.split('/anime/')[1].split('/')[0],
               title: title, url: href, type: 'anime',
               cover: im ? _absUrl(im[1]) : null });
  }
  return out;
}

function getHome(opts) {
  return _getText(BASE + '/animes?order=created').then(function (t1) {
    return _getText(BASE + '/animes').then(function (t2) {
      var rows = [];
      var fresh = _parseCards(t1);
      if (fresh.length) rows.push({ title: 'Últimos agregados', items: fresh });
      var cat = _parseCards(t2);
      if (cat.length) rows.push({ title: 'Catálogo', items: cat });
      return rows;
    });
  });
}

function search(query, page, opts) {
  var u = BASE + '/animes?q=' + encodeURIComponent(query || '');
  return _getText(u).then(function (t) { return _parseCards(t); });
}

function _animeInfo(html) {
  var m = /var anime_info = \["([^"]+)","([^"]*)","([^"]*)"/.exec(html || '');
  if (!m) return null;
  return { id: m[1], title: m[2], slug: m[3] };
}

function getDetail(url, opts) {
  return _getText(url).then(function (t) {
    var info = _animeInfo(t);
    if (!info) throw new Error('anime info not found');
    var cm = /<meta property='og:image' content='([^']+)'/.exec(t) ||
             /<meta property="og:image" content="([^"]+)"/.exec(t);
    var dm = /<div class="Description"[^>]*>([\s\S]{0,4000}?)(<nav|<\/div>\s*<\/div>)/.exec(t);
    var desc = dm ? _stripTags(dm[1]) : '';
    return { id: 'animejl:' + info.id, title: info.title, url: url,
             type: 'anime', cover: cm ? cm[1] : null, description: desc };
  });
}

function getEpisodes(url, opts) {
  return _getText(url).then(function (t) {
    var info = _animeInfo(t);
    if (!info) throw new Error('anime info not found');
    var eps = [];
    var re = /\[(\d+),"([^"]+)","([^"]*)"/g;
    var m;
    while ((m = re.exec(t)) !== null) {
      // guard: only entries inside the episodes array look like
      // [number,"episodio-N","episodes_tumbl/..."]
      if (m[2].indexOf('episodio-') !== 0) continue;
      var num = parseInt(m[1], 10);
      eps.push({ num: num, slug: m[2], thumb: m[3] });
    }
    if (!eps.length) throw new Error('no episodes parsed');
    eps.sort(function (a, b) { return a.num - b.num; });
    var out = [];
    for (var i = 0; i < eps.length; i++) {
      var e = eps[i];
      out.push({ id: 'animejl:' + info.id + ':' + e.num,
                 title: 'Episodio ' + e.num,
                 url: BASE + '/anime/' + info.id + '/' + info.slug + '/' + e.slug,
                 number: e.num,
                 thumbnail: e.thumb ? _absUrl('/storage/' + e.thumb) : null });
    }
    return out;
  });
}

function getVideoSources(episodeUrl) {
  return _getText(episodeUrl).then(function (t) {
    var kind = /latino|castellano/i.test(t) ? 'dub' : 'sub';
    var embeds = [];
    var re = /video\[\d+\]\s*=\s*'<iframe src="([^"]+)"/g;
    var m;
    while ((m = re.exec(t)) !== null) {
      if (/mp4upload\.com\/embed-/i.test(m[1]) && embeds.indexOf(m[1]) === -1) {
        embeds.push(m[1]);
      }
    }
    if (!embeds.length) throw new Error('no MP4Upload server on this episode page');
    var chain = Promise.resolve([]);
    embeds.forEach(function (embedUrl) {
      chain = chain.then(function (acc) {
        return _getText(embedUrl, { Referer: episodeUrl }).then(function (et) {
          var sm = /src:\s*"(https:\/\/[^"]*mp4upload[^"]+\/video\.mp4)"/.exec(et);
          if (sm) {
            acc.push({ url: sm[1], label: '[MP4Upload] ' + (kind === 'dub' ? 'Latino' : 'Sub Español'),
                       container: 'mp4', kind: kind,
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
}
