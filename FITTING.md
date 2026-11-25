# How the fitted multiple was chosen

The board ranks pre-token protocols by implied launch value:

    implied = TVL x fitted multiple x growth multiplier x maturity multiplier

The fitted multiple is the only number in that formula that is not read
straight off a protocol's own record, so this note records how it was
chosen, what was tried and rejected, and how a reader can check it.

## The fit that is used

Take every protocol in the snapshot that already has a token, with a
market cap and a TVL above zero. Divide market cap by TVL. Trim the ratios
outside 0.01-2.0, because a handful of tiny protocols with huge ratios
would otherwise set the multiple for everyone. Take the median of what
remains.

For the 2026-11-14 snapshot that gives:

- 129 live-token protocols in total
- 100 after trimming to ratios 0.01-2.0
- median ratio 0.189, mean ratio 5.0
- fitted multiple 0.189, clamped to the range 0.05-0.5

The mean is useless here: one peer sits at a ratio of 18.96, and the
mean follows the outliers. The median follows the typical protocol.

## The fits that were rejected

Category medians were computed first. They are too noisy to use. The
categories that matter have one to three live peers: Risk Curators has
one, at a ratio of 2.98; Onchain Capital Allocator has two, at 0.019
and 0.006. A multiple built from that is one outlier wearing a
category's name, so categories are not used in the model.

A log-log regression of log(market cap) on log(TVL) was computed next.
Its slope is 0.74, which says larger protocols trade at a lower
multiple of TVL, a real effect. But its residual standard deviation is
1.3 log units, so the fit is too dispersed to rank with: a prediction
from it is wrong by a factor of several either way. It is recorded
here so a reader can see it was checked, and it is the reason the
dashboard shows every implied value with a half-to-double range.

## What the multiple does, and does not, do

The multiple sets the level of the board, not its order. Move it from
0.10 to 0.40 in the sandbox and the top three stay the top three,
because their TVLs are far apart. Growth and maturity move the order
among close rivals; the multiple does not.

That is the honest limit of this model. The snapshot carries no
information about whether a protocol will ever launch a token, or
about what share of a launch a farmer would receive. The board ranks
protocols by the size a token would need to reach to match the
market's own pricing of similar protocols, nothing more.
