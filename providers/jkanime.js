// Jkanime — anime sub-español source for the Zangetsu provider repo (jkanime.net).
//
// Chain (all plain GET, no login):
//   /buscar/<q>/                  -> anime__item cards (link, h5 title, data-setbg cover)
//   /                             -> home: hero__items (Destacados) + "Animes recientes" sidebar
//   /<slug>/                      -> og:title / og:image / meta description
//   /<slug>/<n>/                  -> episode page: video[0] iframe
//                                   https://jkanime.net/jkplayer/um?e=..&t=..&op=..
//   /jkplayer/um?...              -> dplayer shell with url: atob('BASE64')
//                                   -> base64 decode -> direct HLS m3u8
//                                      https://nika.playmudos.com/<show>/<id>.m3u8?st=..&e=..
//
// Notes:
// - Episodes are NOT listed statically on the anime page (JS/AJAX pagination,
//   and the ajax/episodes POST is unreachable from datacenter IPs). The
//   episode count is found by probing /<slug>/<n>/ (clean 404 past the last).
// - The m3u8 token expires (~6h): always resolve fresh per getVideoSources call.
// - Spanish hardcoded subs -> kind 'sub'.
// - Byte-verified 2026-10-17: m3u8 HTTP 200 #EXTM3U VOD; segment HTTP 206,
//   0x47 MPEG-TS sync, "FFmpeg" in PAT.
//
// ES5 only. The app runtime lacks atob/btoa/Buffer — pure-JS base64 below.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'jkanime';

var SITE = 'https://jkanime.net';
var UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
var REF = SITE + '/';

// ── Network ──────────────────────────────────────────────────────────────────
function _fetchText(url, ref, timeoutMs) {
  var headers = { 'User-Agent': UA, 'Referer': ref || REF };
  var p = fetch(url, { headers: headers }).then(function (r) {
    return { ok: r.ok, status: r.status, body: String((r && r.body) || '') };
  });
  return _raceTimeout(p, timeoutMs || 12000, 'Jkanime: timeout ' + url);
}
function _get(url, ref, timeoutMs) {
  return _fetchText(url, ref, timeoutMs).then(function (r) {
    if (!r.ok) throw new Error('Jkanime: HTTP ' + r.status + ' ' + url);
    return r.body;
  });
}
// Rejects if p does not settle in ms. No-op if the runtime lacks timers.
function _raceTimeout(p, ms, msg) {
  if (typeof setTimeout !== 'function') return p;
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error(msg)); }, ms);
    p.then(function (v) { clearTimeout(t); resolve(v); },
           function (e) { clearTimeout(t); reject(e); });
  });
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
function _dec(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); });
}
function _og(html, prop) {
  var m = String(html || '').match(
    new RegExp('<meta\\s+property="og:' + prop + '"\\s+content="([^"]*)"', 'i'));
  return m ? _dec(m[1]) : null;
}
function _metaDesc(html) {
  var m = String(html || '').match(
    /<meta\s+name="description"\s+content="([^"]*)"/i);
  return m ? _dec(m[1]) : null;
}
function _cleanTitle(t) {
  return _dec(t || '').replace(/\s+/g, ' ').trim();
}

/* Pure-JS base64 decoder (standard + URL-safe alphabets, padding optional). */
function _b64decode(input) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var lookup = {};
  for (var i = 0; i < alphabet.length; i++) lookup[alphabet.charAt(i)] = i;
  lookup['-'] = 62; lookup['_'] = 63;
  var str = String(input || '').replace(/=+$/, '');
  var out = '';
  var buffer = 0, bits = 0;
  for (var j = 0; j < str.length; j++) {
    var c = str.charAt(j);
    if (!(c in lookup)) continue;
    buffer = (buffer << 6) | lookup[c];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

function _slugOf(url) {
  var m = String(url || '').match(/^https?:\/\/jkanime\.net\/([a-z0-9-]+)\/?/i);
  return m ? m[1] : null;
}
function _item(href, title, cover) {
  var item = { id: href, title: _cleanTitle(title), url: href, type: 'anime' };
  if (cover) item.cover = cover;
  return item;
}

// ── Search / home parsing ────────────────────────────────────────────────────
function _parseSearch(html) {
  var out = [], seen = {}, m;
  var re = /<div class="anime__item">[\s\S]{0,900}?<a\s+href="(https:\/\/jkanime\.net\/[a-z0-9-]+\/)"[\s\S]{0,900}?data-setbg="([^"]+)"[\s\S]{0,900}?<h5><a[^>]*>([^<]{1,160})<\/a><\/h5>/gi;
  while ((m = re.exec(String(html || ''))) !== null) {
    if (seen[m[1]]) continue;
    seen[m[1]] = 1;
    out.push(_item(m[1], m[3], _dec(m[2])));
  }
  return out;
}

function _parseHome(html) {
  var rows = [];
  var t = String(html || '');
  // Row 1: hero carousel (Destacados).
  var hero = [], seen = {}, m;
  var reH = /<div class="hero__items set-bg" data-setbg="([^"]+)"[\s\S]{0,1600}?<h2>([^<]{1,120})<\/h2>[\s\S]{0,1600}?<a class="slider-show" href="(https:\/\/jkanime\.net\/[a-z0-9-]+\/)"/gi;
  while ((m = reH.exec(t)) !== null) {
    if (seen[m[3]]) continue;
    seen[m[3]] = 1;
    var it = _item(m[3], m[2], null);
    it.banner = _dec(m[1]);
    hero.push(it);
  }
  if (hero.length) rows.push({ title: 'Destacados', items: hero });
  // Row 2: "Animes recientes" sidebar cards.
  var rec = [], seen2 = {}, m2;
  var reR = /<div class="p-3 d-flex">[\s\S]{0,700}?<img src="([^"]+)"[^>]*alt="([^"]*)"[\s\S]{0,300}?<h5 class="card-title"><a href="(https:\/\/jkanime\.net\/[a-z0-9-]+\/)">([^<]{1,120})<\/a>/gi;
  while ((m2 = reR.exec(t)) !== null) {
    if (seen2[m2[3]]) continue;
    seen2[m2[3]] = 1;
    rec.push(_item(m2[3], m2[4] || m2[2], _dec(m2[1])));
  }
  if (rec.length) rows.push({ title: 'Animes recientes', items: rec });
  return rows;
}

// ── Episodes: probe /<slug>/<n>/ (clean 404 past the last episode) ───────────
function _epExists(slug, n) {
  return _fetchText(SITE + '/' + slug + '/' + n + '/', REF, 10000)
    .then(function (r) { return r.ok; })
    .catch(function () { return false; });
}
// Exponential upper bound, then binary search. Probes run sequentially;
// worst case ~2*log2(N) requests.
function _episodeCount(slug) {
  return _epExists(slug, 1).then(function (first) {
    if (!first) throw new Error('Jkanime: episode 1 missing for ' + slug);
    var hi = 1;
    function grow() {
      var next = hi * 2;
      if (next > 4096) return Promise.resolve(hi);
      return _epExists(slug, next).then(function (ok) {
        if (ok) { hi = next; return grow(); }
        return _bisect(slug, hi, next);
      });
    }
    return grow();
  });
}
function _bisect(slug, lo, hi) {
  // lo exists, hi 404s. Find largest existing n.
  if (hi - lo <= 1) return Promise.resolve(lo);
  var mid = Math.floor((lo + hi) / 2);
  return _epExists(slug, mid).then(function (ok) {
    return ok ? _bisect(slug, mid, hi) : _bisect(slug, lo, mid);
  });
}
function _episodesFor(slug) {
  return _episodeCount(slug).then(function (count) {
    var out = [];
    for (var n = 1; n <= count; n++) {
      var url = SITE + '/' + slug + '/' + n + '/';
      out.push({ id: url, title: 'Episodio ' + n, url: url, number: n });
    }
    return out;
  });
}

// ── Video sources ────────────────────────────────────────────────────────────
function _resolveUm(epUrl, idx) {
  // idx 0 = UM (primary), 1 = UMV (backup). video[2] (jk/Amazon) is dead.
  return _get(epUrl, REF, 12000).then(function (html) {
    var re = /video\[(\d)\]\s*=\s*'<iframe[^>]*src="(https:\/\/jkanime\.net\/jkplayer\/(?:um|umv)[^"]+)"/gi;
    var urls = [], m;
    while ((m = re.exec(html)) !== null) urls[parseInt(m[1], 10)] = m[2];
    var um = urls[idx];
    if (!um) throw new Error('Jkanime: no jkplayer entry [' + idx + ']');
    return _get(_dec(um), epUrl, 12000);
  }).then(function (playerHtml) {
    var m = String(playerHtml).match(/url:\s*atob\('([A-Za-z0-9+\/=]+)'\)/);
    if (!m) throw new Error('Jkanime: no atob stream payload');
    var media = _b64decode(m[1]).trim();
    if (!/^https?:\/\//i.test(media)) throw new Error('Jkanime: bad media URL');
    // Validate the playlist is a live, playable HLS manifest.
    return _fetchText(media, REF, 12000).then(function (r) {
      if (!r.ok || r.body.indexOf('#EXTM3U') < 0) {
        throw new Error('Jkanime: playlist check failed HTTP ' + r.status);
      }
      return {
        url: media,
        quality: 'Auto',
        label: 'Jkanime · ' + (idx === 0 ? 'UM' : 'UMV'),
        container: 'hls',
        kind: 'sub',
        headers: { 'User-Agent': UA, 'Referer': REF }
      };
    });
  });
}

// ── Contract ─────────────────────────────────────────────────────────────────
function getInfo() {
  return {
    name: 'Jkanime', lang: 'es', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.0'
  };
}
function getHome(opts) {
  return _get(SITE + '/', null, 15000).then(_parseHome);
}
function search(query, page, opts) {
  var q = encodeURIComponent(String(query || '').trim().toLowerCase().replace(/\s+/g, '-'));
  if (!q) return Promise.resolve([]);
  return _get(SITE + '/buscar/' + q + '/', null, 15000).then(_parseSearch);
}
function getDetail(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('Jkanime: bad detail URL'));
  return _get(SITE + '/' + slug + '/', null, 15000).then(function (html) {
    var title = _og(html, 'title') || _cleanTitle(slug.replace(/-/g, ' '));
    return {
      id: SITE + '/' + slug + '/', title: title,
      url: SITE + '/' + slug + '/', type: 'anime',
      cover: _og(html, 'image'), description: _metaDesc(html)
    };
  });
}
function getEpisodes(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('Jkanime: bad episode URL'));
  return _episodesFor(slug);
}
function getVideoSources(episodeUrl) {
  // UM first, UMV as fallback.
  return _resolveUm(episodeUrl, 0).then(function (s) { return [s]; })
    .catch(function () {
      return _resolveUm(episodeUrl, 1).then(function (s) { return [s]; });
    });
}
