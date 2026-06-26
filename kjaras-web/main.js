(function () {
  'use strict';

  var nav = document.getElementById('nav');
  var burger = document.getElementById('burger');
  var navLinks = document.getElementById('navLinks');

  window.addEventListener('scroll', function () {
    nav.classList.toggle('scrolled', window.scrollY > 60);
  }, { passive: true });

  if (burger && navLinks) {
    burger.addEventListener('click', function () {
      burger.classList.toggle('active');
      navLinks.classList.toggle('open');
    });
    navLinks.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        burger.classList.remove('active');
        navLinks.classList.remove('open');
      });
    });
  }

  var data = window.__KJARAS__;
  if (data) {
    var grid = document.getElementById('productosGrid');
    if (grid && data.products && data.photos) {
      data.products.forEach(function (p, i) {
        var card = document.createElement('div');
        card.className = 'producto-card reveal';
        var img = p.photo || data.photos[i % data.photos.length];
        card.innerHTML = '<div class="producto-img"><img src="assets/img/' + img + '" alt="' + p.name + '" loading="lazy"></div><div class="producto-body"><span class="icon">' + p.icon + '</span><h3>' + p.name + '</h3><p>' + p.desc + '</p></div>';
        grid.appendChild(card);
      });
    }

    var inclBox = document.getElementById('includesBox');
    if (inclBox && data.includes) {
      data.includes.forEach(function (item) {
        var span = document.createElement('span');
        span.textContent = item;
        inclBox.appendChild(span);
      });
    }

    var evBox = document.getElementById('eventsBox');
    if (evBox && data.events) {
      data.events.forEach(function (ev) {
        var span = document.createElement('span');
        span.textContent = ev;
        evBox.appendChild(span);
      });
    }

    var galGrid = document.getElementById('galeriaGrid');
    if (galGrid && data.photos) {
      data.photos.forEach(function (photo) {
        var item = document.createElement('div');
        item.className = 'galeria-item';
        item.innerHTML = '<img src="assets/img/' + photo + '" alt="Kjaras" loading="lazy">';
        galGrid.appendChild(item);
      });
    }
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (id === '#') return;
      var target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
      }
    });
  });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
  document.querySelectorAll('.reveal').forEach(function (el) { observer.observe(el); });

})();
