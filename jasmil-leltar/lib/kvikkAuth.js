const { loadConfig } = require('./kvikkConfig');

/**
 * A leltár alkalmazás többi része szándékosan nem kér hitelesítést (megbízható
 * belső hálózat). A Kvikk végpontok viszont valódi költséggel járó futárcímke-
 * létrehozást indítanak el, ezért ezeket külön, egy tokennel védjük - ezt a
 * Chrome-bővítmény küldi minden kéréssel.
 */
function requireKvikkToken(req, res, next) {
  const config = loadConfig();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || token !== config.extensionToken) {
    return res.status(401).json({ error: 'Érvénytelen vagy hiányzó Kvikk extension token.' });
  }
  next();
}

module.exports = { requireKvikkToken };
