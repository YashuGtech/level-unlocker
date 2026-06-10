/**
 * BSCScan API — verify GTC token deposits.
 * Server-only.
 */
const DEPOSIT_ADDRESS = "0xe724D2800Cf0Af62aB7f3e08f2f6AD32900c1491".toLowerCase();
const TOKEN_CONTRACT = "0xd1f6cc234b9b82e90ac277c9c2e3c7a91d17daf9".toLowerCase();

export type TxVerifyResult =
  | { ok: true; amountToken: number; from: string; blockNumber: string; raw: unknown }
  | { ok: false; reason: string; raw?: unknown };

/**
 * Verify a BEP-20 token transfer tx hash on BSC.
 * Checks: token contract matches, `to` matches deposit address, tx succeeded.
 */
export async function verifyTokenTransfer(
  txHash: string,
  apiKey: string,
): Promise<TxVerifyResult> {
  if (!apiKey) return { ok: false, reason: "BSCScan API key not configured" };
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { ok: false, reason: "Invalid tx hash format" };
  }

  // 1. Check tx receipt status (success/failure)
  const receiptUrl = `https://api.bscscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}&apikey=${apiKey}`;
  const receiptRes = await fetch(receiptUrl);
  const receiptJson = (await receiptRes.json()) as { result?: { status?: string } };
  if (receiptJson?.result?.status !== "1") {
    return { ok: false, reason: "Transaction failed or not found on chain", raw: receiptJson };
  }

  // 2. Get token transfer logs via tokentx for the deposit address, find matching hash.
  // Strategy: query proxy eth_getTransactionReceipt for logs.
  const logsUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${apiKey}`;
  const logsRes = await fetch(logsUrl);
  const logsJson = (await logsRes.json()) as {
    result?: {
      status?: string;
      blockNumber?: string;
      logs?: Array<{ address: string; topics: string[]; data: string }>;
    };
  };
  const receipt = logsJson?.result;
  if (!receipt) return { ok: false, reason: "Receipt unavailable", raw: logsJson };
  if (receipt.status !== "0x1") {
    return { ok: false, reason: "Transaction reverted", raw: logsJson };
  }

  // ERC-20 Transfer event topic
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const matched = (receipt.logs ?? []).find(
    (l) =>
      l.address?.toLowerCase() === TOKEN_CONTRACT &&
      l.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC &&
      l.topics?.[2] &&
      "0x" + l.topics[2].slice(-40).toLowerCase() === DEPOSIT_ADDRESS,
  );
  if (!matched) {
    return {
      ok: false,
      reason: "No matching GTC transfer to deposit address in this tx",
      raw: receipt,
    };
  }

  const from = "0x" + matched.topics[1].slice(-40);
  const amountWei = BigInt(matched.data);
  // GTC uses 18 decimals (standard BEP-20 assumption — confirmed by token page)
  const amountToken = Number(amountWei) / 1e18;

  return {
    ok: true,
    amountToken,
    from,
    blockNumber: receipt.blockNumber ?? "",
    raw: receipt,
  };
}
