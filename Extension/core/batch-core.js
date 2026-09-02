(function initializeBatchCore(global) {
  async function translateInReliableBatches(segments, context, translateBatch, maxBatchSize = 8) {
    const results = [];
    let rollingContext = context;
    for (let index = 0; index < segments.length; index += maxBatchSize) {
      const source = segments.slice(index, index + maxBatchSize);
      const translated = await recoverCountMismatch(source, rollingContext, translateBatch);
      results.push(...translated);
      rollingContext = withPrevious(rollingContext, source, translated);
    }
    return results;
  }

  async function recoverCountMismatch(segments, context, translateBatch, formatRetries = 1) {
    try {
      return await translateBatch(segments, context);
    } catch (error) {
      const message = String(error?.message);
      const formatError = /模型回傳格式異常|JSON Parse error|Unexpected (?:identifier|token)/i.test(message);
      if (formatError && formatRetries > 0) {
        return recoverCountMismatch(segments, context, translateBatch, formatRetries - 1);
      }
      // 格式異常也要拆批，不能只重試後放棄。它最常見的成因是「這一批太長、
      // 輸出被截斷」——溫度是 0，原樣重打必然在同一個地方再斷一次；
      // 拆一半各自變短，輸出就完整了。這正是拆批最能救的情境。
      const recoverable = formatError || /Expected \d+ translations, received/.test(message);
      if (!recoverable) throw error;
      if (segments.length === 1) return translateBatch(segments, context);
      const midpoint = Math.ceil(segments.length / 2);
      const leftSource = segments.slice(0, midpoint);
      const rightSource = segments.slice(midpoint);
      const left = await recoverCountMismatch(leftSource, context, translateBatch, formatRetries);
      const right = await recoverCountMismatch(rightSource, withPrevious(context, leftSource, left), translateBatch, formatRetries);
      return [...left, ...right];
    }
  }

  function withPrevious(context, source, translated) {
    return {
      ...context,
      previous: [
        ...(context?.previous || []),
        ...source.map((text, index) => ({ source: text, translation: translated[index] }))
      ].slice(-8)
    };
  }

  const batchCore = Object.freeze({ translateInReliableBatches });
  global.ImmerseFreeBatchCore = batchCore;
})(globalThis);
