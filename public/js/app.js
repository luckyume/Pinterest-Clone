/* Pic-terest front end.
 *
 * Responsibilities:
 *   - load session + wall data from /api
 *   - render the Pinterest-style wall with Masonry
 *   - link / delete images
 *   - replace broken images with the placeholder (jQuery error detection)
 *   - tiny history-based router (/ , /my , /u/:id , /users)
 */
(function () {
  'use strict';

  var PLACEHOLDER = '/images/placeholder.png';
  var AVATAR_FALLBACK = '/images/avatar-fallback.png';

  var state = {
    user: null,
    oauthConfigured: true,
    devLoginUsername: null,
    view: 'all', // all | my | user | members
    userId: null,
    owner: null,
    pics: [],
    loading: true,
    error: null,
  };

  var masonry = null;
  var toastTimer = null;

  // ------------------------------------------------------------- utilities

  function $(sel) {
    return document.querySelector(sel);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function api(path, options) {
    return fetch(path, options).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch (err) {
          body = null;
        }
        if (!res.ok) {
          var error = new Error((body && (body.error || body.status)) || res.statusText);
          error.status = res.status;
          throw error;
        }
        return body;
      });
    });
  }

  function post(url, payload, method) {
    return api(url, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  }

  function toast(message, kind) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast' + (kind === 'error' ? ' is-error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.hidden = true;
    }, 3600);
  }

  // ------------------------------------------- broken image detection
  //
  // jQuery binds an `error` handler to every <img> on the wall; anything that
  // fails to load (404, dead host, malformed url) is swapped for the
  // placeholder image. Images that already failed before the handler was
  // attached are detected through their `complete` flag.

  function swapForFallback(img) {
    var $img = window.jQuery(img);
    var fallback = img.getAttribute('data-fallback') || PLACEHOLDER;
    if (img.getAttribute('src') === fallback) return;

    if (!img.getAttribute('data-original-src')) {
      img.setAttribute('data-original-src', img.getAttribute('src') || '');
    }
    img.setAttribute('data-placeholder', 'true');
    img.classList.add('is-placeholder');
    $img.off('error'); // never loop if the fallback itself is unavailable
    img.setAttribute('src', fallback);
    if (masonry) masonry.layout();
  }

  function guardImages(root) {
    window.jQuery(root)
      .find('img')
      .each(function () {
        var $img = window.jQuery(this);
        if ($img.data('guarded')) return;
        $img.data('guarded', true);
        $img.on('error', function () {
          swapForFallback(this);
        });
        if (this.complete && this.naturalWidth === 0) swapForFallback(this);
      });
  }

  // ----------------------------------------------------------------- cards

  function deleteIcon() {
    return (
      '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">' +
      '<path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    );
  }

  function cardHTML(pic) {
    var owner = pic.ownerId || {};
    var github = owner.github || {};
    var isMine = Boolean(state.user && owner._id === state.user._id);
    var alt = pic.description || 'Linked image';

    return (
      '<article class="grid-item" data-id="' +
      esc(pic._id) +
      '" data-testid="image-card">' +
      '<div class="main-img">' +
      '<img src="' +
      esc(pic.url) +
      '" alt="' +
      esc(alt) +
      '" decoding="async">' +
      '<p class="caption">' +
      esc(pic.description) +
      "</p></div>" +
      '<div class="info">' +
      '<a class="owner" href="/u/' +
      esc(owner._id) +
      '" title="View @' +
      esc(github.username || 'unknown') +
      '\'s wall">' +
      '<img class="owner-avatar" src="' +
      esc(github.imageUrl || AVATAR_FALLBACK) +
      '" data-fallback="' +
      AVATAR_FALLBACK +
      '" alt="">' +
      '<span class="owner-name">@' +
      esc(github.username || 'unknown') +
      "</span></a>" +
      (isMine
        ? '<button type="button" class="btn-delete" data-delete="' +
          esc(pic._id) +
          '" data-testid="delete-pic" title="Delete image" aria-label="Delete image">' +
          deleteIcon() +
          "</button>"
        : "") +
      "</div></article>"
    );
  }

  function renderWall() {
    var grid = $('#grid');
    var empty = $('#emptyState');

    if (masonry) {
      masonry.destroy();
      masonry = null;
    }

    grid.innerHTML = '<span class="grid-sizer" aria-hidden="true"></span>';

    var hasPics = state.pics.length > 0;
    empty.hidden = hasPics;
    grid.hidden = !hasPics;

    if (!hasPics) {
      $('#emptyTitle').textContent = emptyMessage().title;
      $('#emptyText').textContent = emptyMessage().text;
      return;
    }

    var fragment = document.createDocumentFragment();
    var holder = document.createElement('div');
    holder.innerHTML = state.pics.map(cardHTML).join('');
    while (holder.firstChild) fragment.appendChild(holder.firstChild);
    grid.appendChild(fragment);

    guardImages(grid);

    masonry = new window.Masonry(grid, {
      itemSelector: '.grid-item',
      columnWidth: '.grid-sizer',
      gutter: 24,
      fitWidth: true,
      transitionDuration: '0.2s',
    });

    window.imagesLoaded(grid).on('progress', function () {
      if (masonry) masonry.layout();
    });
    masonry.layout();
  }

  function emptyMessage() {
    if (state.view === 'my') {
      return {
        title: 'Your wall is empty',
        text: 'Paste an image url above, add a description and hit Send to pin your first pic.',
      };
    }
    if (state.view === 'user') {
      return {
        title: 'Nothing pinned yet',
        text: (state.owner ? '@' + state.owner.github.username : 'This member') +
          ' has not linked any images yet.',
      };
    }
    return {
      title: 'The wall is empty',
      text: 'Paste an image url above and hit Send to pin the first one.',
    };
  }

  function renderMembers(users) {
    var list = $('#members');
    list.innerHTML = users
      .map(function (user) {
        return (
          '<li class="member-card">' +
          '<img class="member-avatar" src="' +
          esc(user.github.imageUrl || AVATAR_FALLBACK) +
          '" data-fallback="' +
          AVATAR_FALLBACK +
          '" alt="">' +
          '<div class="member-meta">' +
          '<p class="member-name">@' +
          esc(user.github.username) +
          "</p>" +
          '<p class="member-sub">' +
          esc(user.github.displayName || user.github.username) +
          " &middot; " +
          (user.picCount || 0) +
          " pic" +
          (user.picCount === 1 ? '' : 's') +
          "</p>" +
          '<a class="member-link" href="/u/' +
          esc(user._id) +
          '">View wall &rarr;</a>' +
          "</div></li>"
        );
      })
      .join('');
    guardImages(list);
  }

  function setHead(title, subtitle, count) {
    $('#wallTitle').textContent = title;
    $('#wallSubtitle').innerHTML =
      (subtitle ? esc(subtitle) + ' ' : '') +
      (typeof count === 'number'
        ? '<span class="count">' + count + ' image' + (count === 1 ? '' : 's') + '</span>'
        : '');
  }

  function setActiveNav() {
    var items = document.querySelectorAll('#navLinks li');
    Array.prototype.forEach.call(items, function (li) {
      li.classList.toggle('is-active', li.getAttribute('data-nav') === state.view);
    });
  }

  function showLoading(loading) {
    state.loading = loading;
    $('#preloader').hidden = !loading;
    $('#grid').hidden = loading || state.pics.length === 0;
    $('#emptyState').hidden = loading || state.pics.length > 0;
    $('#members').hidden = true;
    $('#addForm').classList.toggle('is-busy', loading);
  }

  // --------------------------------------------------------------- routing

  function parseRoute() {
    var path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/users') return { view: 'members' };
    if (path === '/my') return { view: 'my' };
    var match = path.match(/^\/u\/([^/]+)$/);
    if (match) return { view: 'user', id: decodeURIComponent(match[1]) };
    return { view: 'all' };
  }

  function navigate(path) {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    renderRoute();
  }

  function renderRoute() {
    var route = parseRoute();
    state.view = route.view;
    state.userId = route.id || null;
    state.error = null;
    setActiveNav();

    if (route.view === 'members') {
      showLoading(true);
      setHead('Members', 'Everyone who has pinned something -');
      return api('/api/users')
        .then(function (users) {
          state.loading = false;
          $('#preloader').hidden = true;
          $('#grid').hidden = true;
          $('#members').hidden = false;
          setHead('Members', 'Everyone who has pinned something -', users.length);
          renderMembers(users);
        })
        .catch(handleError);
    }

    showLoading(true);

    var load;
    if (route.view === 'all') {
      setHead('Fresh links', 'Everything anyone has pinned, newest first -');
      load = api('/api/pics').then(function (pics) {
        state.pics = pics;
        state.owner = null;
      });
    } else if (route.view === 'my') {
      if (!state.user) {
        setHead('Sign in required', 'Your wall lives behind a GitHub login.');
        state.pics = [];
        showLoading(false);
        $('#emptyTitle').textContent = 'Sign in to see your wall';
        $('#emptyText').innerHTML =
          'Use <a href="/auth/github">Login with GitHub</a> to link images and keep your own wall.';
        return;
      }
      setHead('Your wall', 'Pics you have linked -');
      load = api('/api/pics/' + state.user._id).then(function (pics) {
        state.pics = pics;
        state.owner = state.user;
      });
    } else {
      setHead('Loading wall…', '');
      load = Promise.all([
        api('/api/users/' + route.id),
        api('/api/users/' + route.id + '/pics'),
      ]).then(function (results) {
        state.owner = results[0];
        state.pics = results[1];
        setHead(
          '@' + results[0].github.username,
          (results[0].github.displayName || '') + ' has pinned -',
          results[1].length
        );
      });
    }

    return load
      .then(function () {
        if (route.view === 'all') setHead('Fresh links', 'Everything anyone has pinned, newest -', state.pics.length);
        if (route.view === 'my') setHead('Your wall', 'Pics you have linked -', state.pics.length);
        showLoading(false);
        renderWall();
      })
      .catch(handleError);
  }

  function handleError(err) {
    state.error = err;
    showLoading(false);
    $('#members').hidden = true;
    setHead('Could not load', err && err.message ? err.message : 'Something went wrong.');
    toast('Something went wrong loading the wall.', 'error');
  }

  // ------------------------------------------------------------ auth UI

  function applyAuthUI() {
    var signedIn = Boolean(state.user);
    $('#loginBtn').hidden = signedIn;
    $('#logoutBtn').hidden = !signedIn;
    $('#navMyPics').hidden = !signedIn;
    setActiveNav();
  }

  function applyDevBanner() {
    if (state.oauthConfigured) return;
    var banner = $('#devBanner');
    banner.innerHTML =
      '<strong>Dev mode</strong> &mdash; GitHub OAuth is not configured, so ' +
      '<code>Login with GitHub</code> signs you in locally' +
      (state.devLoginUsername ? ' as <code>@' + esc(state.devLoginUsername) + '</code>' : '') +
      '. Set <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> for the real flow.';
    banner.hidden = false;
  }

  // ------------------------------------------------------------ add form

  function handleAdd(event) {
    event.preventDefault();
    var urlInput = $('#picUrl');
    var descInput = $('#picDesc');
    var url = urlInput.value.trim();

    if (!url) {
      urlInput.focus();
      return;
    }
    if (!state.user) {
      toast('Sign in with GitHub to link an image.', 'error');
      return;
    }

    post('/api/pics', { url: url, description: descInput.value.trim() })
      .then(function (pic) {
        urlInput.value = '';
        descInput.value = '';
        var onOwnWall = state.view === 'all' || state.view === 'my' ||
          (state.view === 'user' && state.owner && state.owner._id === state.user._id);
        if (onOwnWall) {
          state.pics.unshift(pic);
          renderWall();
          if (state.view === 'all') {
            setHead('Fresh links', 'Everything anyone has pinned, newest -', state.pics.length);
          } else if (state.view === 'my') {
            setHead('Your wall', 'Pics you have linked -', state.pics.length);
          } else {
            setHead('@' + state.owner.github.username, 'has pinned -', state.pics.length);
          }
        } else {
          navigate('/my');
        }
        toast('Pinned!');
      })
      .catch(function (err) {
        if (err.status === 401) toast('Sign in with GitHub to link an image.', 'error');
        else toast(err.message || 'Could not link that image.', 'error');
      });
  }

  // -------------------------------------------------------------- deletes

  function handleGridClick(event) {
    var button = event.target.closest ? event.target.closest('[data-delete]') : null;
    if (!button) return;
    var id = button.getAttribute('data-delete');
    button.disabled = true;

    api('/api/pics/' + id, { method: 'DELETE', headers: { Accept: 'application/json' } })
      .then(function () {
        state.pics = state.pics.filter(function (pic) {
          return pic._id !== id;
        });
        if (state.view === 'all') setHead('Fresh links', 'Everything anyone has pinned, newest -', state.pics.length);
        if (state.view === 'my') setHead('Your wall', 'Pics you have linked -', state.pics.length);
        if (state.view === 'user' && state.owner) {
          setHead('@' + state.owner.github.username, 'has pinned -', state.pics.length);
        }
        renderWall();
        toast('Image deleted.');
      })
      .catch(function (err) {
        button.disabled = false;
        toast(err.message || 'Could not delete that image.', 'error');
      });
  }

  // ------------------------------------------------------------- boot

  function interceptLinks() {
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var link = event.target.closest ? event.target.closest('a[href]') : null;
      if (!link) return;
      var href = link.getAttribute('href');
      if (!href || href.charAt(0) !== '/') return; // external
      if (href.indexOf('/auth') === 0 || href.indexOf('/logout') === 0) return; // server round trip
      event.preventDefault();
      navigate(href);
    });
  }

  function init() {
    interceptLinks();
    $('#addForm').addEventListener('submit', handleAdd);
    $('#grid').addEventListener('click', handleGridClick);
    window.addEventListener('popstate', renderRoute);
    window.addEventListener('resize', function () {
      if (masonry) masonry.layout();
    });

    Promise.all([
      api('/api/config').catch(function () {
        return { oauthConfigured: true };
      }),
      api('/api/user').catch(function () {
        return { status: 'unauthenticated' };
      }),
    ]).then(function (results) {
      state.oauthConfigured = results[0].oauthConfigured !== false;
      state.devLoginUsername = results[0].devLoginUsername || null;
      state.user = results[1].status === 'unauthenticated' ? null : results[1];
      applyDevBanner();
      applyAuthUI();
      renderRoute();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
