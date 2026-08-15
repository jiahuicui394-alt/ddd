import { NextResponse } from "next/server";
import { hasExternalProvider } from "@/lib/commute-provider";
import { searchDestinationSuggestions } from "@/lib/place-search";

export async function GET(request: Request) {
  try {
    if (!hasExternalProvider()) {
      return NextResponse.json(
        { error: "TravelTime 尚未配置。" },
        { status: 503 },
      );
    }

    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) return NextResponse.json({ suggestions: [] });

    const suggestions = await searchDestinationSuggestions(query);
    return NextResponse.json({ suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "地点搜索失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
