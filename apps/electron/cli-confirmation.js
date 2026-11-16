const parameters = new URLSearchParams(location.search);
// Wording arrives from main already translated; the HTML text stays as fallback.
let messages = {};
try { messages = JSON.parse(parameters.get('messages') || '{}') || {}; } catch { messages = {}; }
if (/^[A-Za-z-]+$/.test(parameters.get('lang') || '')) document.documentElement.lang = parameters.get('lang');
for (const node of document.querySelectorAll('[data-text]')) if (typeof messages[node.dataset.text] === 'string') node.textContent = messages[node.dataset.text];
if (typeof messages.title === 'string') document.title = messages.title;
if (typeof messages.allow === 'string' && messages.allow.includes('{0}')) {
  const allow = document.querySelector('[data-allow]'), [before, after] = messages.allow.split('{0}');
  const command = document.createElement('code'); command.textContent = 'baton';
  allow.replaceChildren(before, command, after);
}
document.querySelector('[data-command-path]').textContent = parameters.get('commandPath') || '';
for (const path of parameters.getAll('profilePath')) {
  const line = document.createElement('p');
  line.className = 'confirmation-path'; line.textContent = path;
  document.querySelector('[data-profile-paths]').append(line);
}
for (const button of document.querySelectorAll('[data-choice]')) button.addEventListener('click', () => {
  location.hash = button.dataset.choice === 'install' ? 'install' : 'cancel';
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); location.hash = 'cancel'; }
});
document.querySelector('[data-choice="cancel"]').focus();
