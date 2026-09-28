const db = require('../db/database');

/**
 * Egy doboz akkor van zárolva, ha van rajta AKTÍV (folyamatban lévő vagy
 * összesítve, de még jóvá nem hagyott) újraszámolás. Ilyenkor a doboz
 * tartalma tudatosan "fagyasztott" - nem lehet bele elhelyezni, belőle
 * kivenni, vagy áthelyezni, amíg a számolás jóváhagyásra vagy elvetésre nem
 * kerül. Ez védi ki, hogy a fizikai újraszámolás közben (amikor a doboz
 * tartalma ténylegesen a kézben/a pulton van) egy párhuzamos művelet
 * érvénytelenítse a számolást.
 */
function getActiveRecount(boxId) {
  return db
    .prepare(`SELECT * FROM box_recounts WHERE box_id = ? AND status IN ('szamolas', 'osszesitve')`)
    .get(boxId);
}

function isBoxLocked(boxId) {
  return !!getActiveRecount(boxId);
}

module.exports = { getActiveRecount, isBoxLocked };
