/* global firebase */
// Handle clicks before loading FCM so notifications reopen this site's own scope.
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = new URL('./', self.registration.scope).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            if (client.url.startsWith(self.registration.scope)) return client.focus();
        }
        return self.clients.openWindow(url);
    })());
});
importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-messaging-compat.js');
firebase.initializeApp({
    apiKey: 'AIzaSyC-5eJaWoM9yQfOtkbjEkm922KQ1Zpbs1A',
    projectId: 'realfarm-todolist',
    messagingSenderId: '93416320476',
    appId: '1:93416320476:web:ca4b13550e5771cf1ff319'
});
// FCM displays notification payloads automatically while the page is closed.
firebase.messaging();
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
