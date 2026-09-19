import { createTransportAlertGrader, FactsResponseError } from 'file:///D:/kanet-nwt-cand/kasia-console/src/lib/proto-settlement-c1.mjs';
const g = createTransportAlertGrader();
const transient = () => new FactsResponseError('facts_transport_error', 'Relay command timeout after 15s');
const out = [];
for (let tick = 1; tick <= 6; tick++) {
  const r = g.onFailure(transient(), tick);       // step A (market 1) fails every tick with a transient error
  out.push(`tick ${tick}: A fails -> level=${r.level} consecutiveTicks=${r.consecutiveTicks}`);
  g.onSuccess();                                  // step B (market 2) succeeds in the same tick -> shared grader is cleared
}
console.log(out.join('\n'));
