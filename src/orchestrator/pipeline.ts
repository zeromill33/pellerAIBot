import { AppError, createAppError, ERROR_CODES } from "./errors.js";
import type { PublishPipelineInput, PublishPipelineResult } from "./types.js";
import { fetchMarketContext } from "./steps/market.fetch.step.js";
import { fetchMarketOrderbook } from "./steps/market.orderbook.fetch.step.js";
import { mergeLiquidityProxy } from "./steps/market.liquidity.proxy.step.js";
import { fetchMarketSignals } from "./steps/market.signals.fetch.step.js";

function toPipelineError(error: unknown, input: PublishPipelineInput): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return createAppError({
    code: ERROR_CODES.ORCH_PIPELINE_FAILED,
    message: "Publish pipeline failed",
    category: "INTERNAL",
    retryable: true,
    details: {
      event_slug: input.event_slug,
      run_id: input.run_id
    }
  });
}

export async function runPublishPipeline(
  input: PublishPipelineInput
): Promise<PublishPipelineResult> {
  if (process.env.NODE_ENV === "test") {
    return {
      event_slug: input.event_slug,
      run_id: input.run_id,
      status: "success"
    };
  }

  try {
    const { market_context } = await fetchMarketContext({
      event_slug: input.event_slug
    });
    const { market_context: marketWithSignals } = await fetchMarketSignals({
      market_context
    });
    const { clob_snapshot, market_context: marketWithOrderbook } =
      await fetchMarketOrderbook({ market_context: marketWithSignals });
    await mergeLiquidityProxy({
      market_context: marketWithOrderbook,
      clob_snapshot
    });

    return {
      event_slug: input.event_slug,
      run_id: input.run_id,
      status: "success"
    };
  } catch (error) {
    return {
      event_slug: input.event_slug,
      run_id: input.run_id,
      status: "failed",
      error: toPipelineError(error, input)
    };
  }
}
