import Foundation

/// Narrows a batch the server rejected as a whole (422/413) down to the sample that caused it,
/// so only that sample is dropped — not the up-to-500 good samples (≈ 8 hours) riding with it.
///
/// It only decides how many samples the NEXT cycle takes from the front of the FIFO buffer; it
/// never makes a cycle send more than one batch. That keeps the engine's one-batch-per-cycle,
/// no-spin rule: a rejection costs one cycle and shrinks the next batch, a success costs one
/// cycle and grows it back.
///
/// - rejected batch of n > 1 → keep it all, next batch is n/2 (the front half).
/// - rejected batch of 1     → that sample is the bad one: drop it, back to full size.
/// - accepted batch          → double the size again, up to full.
///
/// This always terminates. Every success removes the good samples ahead of the bad one, and
/// once the bad sample is at the front every batch contains it, so each cycle halves the size
/// until it is alone and dropped. A bad sample at the front of a full batch is isolated in
/// log2(500) ≈ 9 cycles; one further back takes a few cycles more, and every sample ahead of
/// it is delivered on the way.
struct BatchSplitter {
    let fullSize: Int
    /// How many samples the next cycle takes.
    private(set) var size: Int

    init(fullSize: Int) {
        self.fullSize = max(1, fullSize)
        self.size = self.fullSize
    }

    /// The batch just sent (`count` samples) was rejected as a whole. Returns true when it is a
    /// single sample — isolated, so the caller drops it; false means keep the batch and retry
    /// a smaller one next cycle.
    mutating func rejected(count: Int) -> Bool {
        guard count > 1 else {
            size = fullSize
            return true
        }
        size = max(1, count / 2)
        return false
    }

    /// The batch just sent was accepted.
    mutating func accepted() {
        size = min(fullSize, size * 2)
    }

    /// Which permanent statuses mean "something in this batch is unacceptable" rather than
    /// "this request can never succeed": 422 (a sample failed validation) and 413 (too large).
    static func isSplittable(status: Int) -> Bool {
        status == 422 || status == 413
    }
}
