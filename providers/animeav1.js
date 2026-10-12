// AnimeAV1 v1.0.0 — animeav1.com (anime sub español)
// Chain: /catalogo?search= -> /media/<slug> -> /media/<slug>/__data.json
// (SvelteKit devalue, full episode list) -> /media/<slug>/<n>
// -> MP4Upload embed page -> direct mp4 (verified playable).
// Only MP4Upload is resolvable with plain HTTP; other servers
// (HLS/zilla, Voe, Byse, Mega, 1Fichier) need JS/browser and are skipped.

var BASE = 'https://animeav1.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeAV1', lang: 'es', baseUrl: BASE,
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

function _section(html, startMarker, endMarker) {
  var s = String(html || '');
  var i = s.indexOf(startMarker);
  if (i === -1) return null;
  var j = endMarker ? s.indexOf(endMarker, i) : -1;
  return j === -1 ? s.slice(i) : s.slice(i, j);
}

function _isArr(v) {
  return Object.prototype.toString.call(v) === '[object Array]';
}

// Minimal SvelteKit devalue resolver: the values array holds every value;
// object values and array elements are indices into it. Primitives are
// inline. Stack-based cycle guard keeps shared refs resolving correctly.
function _devalue(data) {
  function res(idx, stack) {
    var v = data[idx];
    if (v !== null && typeof v === 'object') {
      if (stack.indexOf(idx) !== -1) return null;
      stack.push(idx);
      var out, i, k;
      if (_isArr(v)) {
        out = [];
        for (i = 0; i < v.length; i++) out.push(res(v[i], stack));
      } else {
        out = {};
        for (k in v) {
          if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = res(v[k], stack);
        }
      }
      stack.pop();
      return out;
    }
    return v;
  }
  return res(0, []);
}

function _mediaData(jsonText) {
  var d = JSON.parse(jsonText);
  var nodes = (d && d.nodes) || [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n && n.data && _isArr(n.data) && n.data.length) {
      var first = n.data[0];
      if (first && typeof first === 'object' && !_isArr(first) &&
          Object.prototype.hasOwnProperty.call(first, 'media')) {
        var root = _devalue(n.data);
        if (root && root.media) return root.media;
      }
    }
  }
  throw new Error('media data not found in __data.json');
}

function _slugOf(url) {
  var m = /^https?:\/\/[^\/]+\/media\/([^\/\?#]+)/.exec(url || '');
  return m ? m[1] : null;
}

function _parseCards(html) {
  var out = [];
  var parts = String(html || '').split('<article');
  for (var i = 1; i < parts.length; i++) {
    var c = parts[i];
    var hm = /href="(\/media\/[^"\/\?#]+)"/.exec(c);
    if (!hm) continue;
    var href = hm[1];
    if (/\/media\/[^\/]+\/\d+/.test(href)) continue; // episode link, not anime
    var slug = href.split('/').pop();
    var tm = /<h3[^>]*>([^<]+)<\/h3>/.exec(c);
    var im = /<img[^>]+src="(https:\/\/cdn\.animeav1\.com\/covers\/[^"]+)"/.exec(c);
    var title = tm ? tm[1].trim() : slug;
    out.push({ id: 'animeav1:' + slug, title: title, url: BASE + href,
               type: 'anime', cover: im ? im[1] : null });
  }
  return out;
}

function getHome(opts) {
  return _getText(BASE + '/').then(function (t) {
    var rows = [];
    var s1 = _section(t, '>Episodios</h2>', '>Actividad</h2>');
    var epItems = [];
    if (s1) {
      var parts = s1.split('<article');
      for (var i = 1; i < parts.length; i++) {
        var c = parts[i];
        var hm = /href="\/media\/([^"\/]+)\/(\d+)"/.exec(c);
        if (!hm) continue;
        var slug = hm[1], num = hm[2];
        var tm = /<div class="text-2xs text-subs font-bold uppercase">([^<]+)<\/div>/.exec(c);
        var im = /<img[^>]+src="(https:\/\/cdn\.animeav1\.com\/thumbnails\/[^"]+)"/.exec(c);
        var title = (tm ? tm[1].trim() : slug) + ' - Episodio ' + num;
        epItems.push({ id: 'animeav1:' + slug, title: title,
                       url: BASE + '/media/' + slug, type: 'anime',
                       cover: im ? im[1] : null });
      }
    }
    if (epItems.length) rows.push({ title: 'Últimos episodios', items: epItems });
    var s2 = _section(t, '>Animes</h2>', null);
    var anItems = s2 ? _parseCards(s2) : [];
    if (anItems.length) rows.push({ title: 'Animes', items: anItems });
    return rows;
  });
}

function search(query, page, opts) {
  var u = BASE + '/catalogo?search=' + encodeURIComponent(query || '');
  return _getText(u).then(function (t) { return _parseCards(t); });
}

function getDetail(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('bad detail url'));
  return _getText(BASE + '/media/' + slug + '/__data.json').then(function (t) {
    var media = _mediaData(t);
    var title = media.title || slug;
    var cover = (typeof media.id === 'number' && media.id > 0)
      ? 'https://cdn.animeav1.com/covers/' + media.id + '.jpg' : null;
    return { id: 'animeav1:' + slug, title: String(title),
             url: BASE + '/media/' + slug, type: 'anime',
             cover: cover, description: String(media.synopsis || '') };
  });
}

function getEpisodes(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('bad detail url'));
  return _getText(BASE + '/media/' + slug + '/__data.json').then(function (t) {
    var media = _mediaData(t);
    var eps = [];
    for (var k in media) {
      if (!Object.prototype.hasOwnProperty.call(media, k)) continue;
      var v = media[k];
      if (v && _isArr(v) && v.length && v[0] && typeof v[0] === 'object' &&
          typeof v[0].number === 'number') { eps = v; break; }
    }
    var nums = [];
    for (var i = 0; i < eps.length; i++) {
      var n = eps[i].number;
      if (typeof n === 'number' && nums.indexOf(n) === -1) nums.push(n);
    }
    nums.sort(function (a, b) { return a - b; });
    var mid = (typeof media.id === 'number' && media.id > 0) ? media.id : 0;
    var out = [];
    for (var j = 0; j < nums.length; j++) {
      out.push({ id: 'animeav1:' + slug + ':' + nums[j],
                 title: 'Episodio ' + nums[j],
                 url: BASE + '/media/' + slug + '/' + nums[j],
                 number: nums[j],
                 thumbnail: mid ? 'https://cdn.animeav1.com/screenshots/' + mid + '/' + nums[j] + '.jpg' : null });
    }
    return out;
  });
}

function getVideoSources(episodeUrl) {
  return _getText(episodeUrl).then(function (t) {
    var servers = [];
    var re = /\{server:"([^"]+)",url:"([^"]+)"\}/g;
    var m;
    while ((m = re.exec(t)) !== null) servers.push({ name: m[1], url: m[2] });
    var embeds = [];
    for (var i = 0; i < servers.length; i++) {
      if (/mp4upload/i.test(servers[i].name) && /mp4upload\.com\/embed-/i.test(servers[i].url)) {
        if (embeds.indexOf(servers[i].url) === -1) embeds.push(servers[i].url);
      }
    }
    if (!embeds.length) throw new Error('no MP4Upload server on this episode page');
    var chain = Promise.resolve([]);
    embeds.forEach(function (embedUrl) {
      chain = chain.then(function (acc) {
        return _getText(embedUrl, { Referer: episodeUrl }).then(function (et) {
          var sm = /src:\s*"(https:\/\/[^"]*mp4upload[^"]+\/video\.mp4)"/.exec(et);
          if (sm) {
            acc.push({ url: sm[1], label: '[MP4Upload] Sub Español',
                       container: 'mp4', kind: 'sub',
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
