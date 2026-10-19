# Current validation

Eight baseline failures cover all five findings;53 new regressions cover auth,
clock, provider capability, credit/refund and ownership boundaries. Previous128
regressions retained. Two old fixtures now isolate order-only expiry and enforce
the new refund cooldown while preserving original no-write/price/once checks.
FullWorld3126pass,0fail,5 existing skips; portable financial675,contracts30,
Python26 pass, plus native workerd D1. No real signature/public-chain transaction
or peak capacity measurement is claimed.
