<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { motion } from '$lib/motion.svelte';
	import { DEFAULT_BUDGET_HOURS } from '$lib/progress';
	import { shouldRedirectToApp } from '$lib/landing';

	let tab = $state<'timeline' | 'list' | 'cards'>('timeline');
	// Set in afterNavigate below — true when this page renders at all for a
	// returning user (a cold load never gets here; it redirects before this
	// component's markup matters). Swaps the CTAs from "start" to "back to
	// what you already have" so a welcomed visitor who reached this page via
	// the logo (#196) isn't offered onboarding they don't need.
	let welcomed = $state(false);

	// ── Product mock data ─────────────────────────────────────────────────
	// The mock is a deliberately miniature, stylized impression of the three
	// queue views — not a render of the real components. Those need real
	// WatchlistItems, live handlers, and TMDB image loads, none of which
	// belong on a marketing page. Driving all three tabs from these two
	// arrays instead keeps them from drifting apart from each other, which
	// is what happened when each tab hand-wrote its own near-identical
	// rows and cards (#131).

	type MockBar = { title: string; time: string; width: string };
	type MockLane = {
		label: string;
		meta: string;
		accent: string;
		rowBg: string;
		rowBorder: string;
		barBg: string;
		barBorder: string;
		logoBg: string;
		logoBorder: string;
		logoText: string;
		logoTextColor: string;
		logoTextSize: string;
		bars: MockBar[];
		over: string | null;
	};

	const mockLanes: MockLane[] = [
		{
			label: 'Hulu',
			meta: '2 titles · 27h 43m',
			accent: '#1ce783',
			rowBg: '#0c1a0f',
			rowBorder: '#1a3020',
			barBg: '#112218',
			barBorder: '#1c3a24',
			logoBg: '#1ce783',
			logoBorder: '#1ce783',
			logoText: 'hulu',
			logoTextColor: '#000',
			logoTextSize: '9px',
			bars: [{ title: 'The Bear', time: '~26h', width: '62%' }],
			over: null
		},
		{
			label: 'Apple TV',
			meta: '2 titles · 41h 38m',
			accent: '#4da6ff',
			rowBg: '#0c1420',
			rowBorder: '#1a2436',
			barBg: '#0e1e30',
			barBorder: '#1a2e44',
			logoBg: '#1d1d1f',
			logoBorder: '#333',
			logoText: '📺',
			logoTextColor: '#fff',
			logoTextSize: '13px',
			bars: [
				{ title: 'Severance', time: '~13h', width: '30%' },
				{ title: 'Ted Lasso', time: '~29h', width: '40%' }
			],
			over: '+1.6h over'
		}
	];

	type MockTitle = {
		title: string;
		listPoster: string;
		cardPoster: string;
		providers: { label: string; bg: string; color: string }[];
		seasons: boolean;
		pct: number;
		time: string;
	};

	const mockTitles: MockTitle[] = [
		{
			title: 'The Princess Bride',
			listPoster: 'linear-gradient(145deg,#2a3a1a,#3d5c28)',
			cardPoster: 'linear-gradient(160deg,#2a4018,#3d5c28,#1a2a10)',
			providers: [
				{ label: 'hulu', bg: '#1ce783', color: '#000' },
				{ label: 'fubo', bg: '#e8242d', color: '#fff' }
			],
			seasons: false,
			pct: 18,
			time: '1h 39m'
		},
		{
			title: 'The Bear',
			listPoster: 'linear-gradient(145deg,#1a2535,#2a3d55)',
			cardPoster: 'linear-gradient(160deg,#1a2535,#2a3d55,#0d1825)',
			providers: [{ label: 'hulu', bg: '#1ce783', color: '#000' }],
			seasons: true,
			pct: 82,
			time: '~26h'
		}
	];

	const WATCHED_SEASONS = ['S1', 'S2', 'S3', 'S4'];

	// #196: see landing.ts for the redirect condition itself and why it's
	// pulled out as a plain function.
	afterNavigate((navigation) => {
		try {
			const isLanding = new URLSearchParams(window.location.search).has('landing');
			const isWelcomed = localStorage.getItem('sq:welcomed') === '1';
			welcomed = isWelcomed;
			if (shouldRedirectToApp(navigation.type, isWelcomed, isLanding)) {
				goto(resolve('/app'), { replaceState: true });
			}
		} catch {
			// Best-effort localStorage read; app shows landing page if check fails
		}
	});

	onMount(() => {
		// Parallax blobs
		const blobs = [...document.querySelectorAll<HTMLElement>('[data-parallax]')];
		function onScroll() {
			const y = window.scrollY;
			blobs.forEach((b) => {
				const s = parseFloat(b.dataset.parallax ?? '0.1');
				b.style.transform = `translateY(${y * s}px)`;
			});
		}
		window.addEventListener('scroll', onScroll, { passive: true });

		// Scroll-reveal (skipped when reduced motion is preferred)
		const revealEls = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
		let io: IntersectionObserver | null = null;
		if (!motion.reduced) {
			io = new IntersectionObserver(
				(entries) => {
					entries.forEach((e) => {
						if (e.isIntersecting) {
							const el = e.target as HTMLElement;
							el.style.opacity = '1';
							el.style.transform = 'translateY(0)';
							io!.unobserve(el);
						}
					});
				},
				{ threshold: 0.1 }
			);
			revealEls.forEach((h) => {
				h.style.opacity = '0';
				h.style.transform = 'translateY(26px)';
				h.style.transition = 'opacity .5s ease, transform .5s ease';
				io!.observe(h);
			});
		}

		return () => {
			window.removeEventListener('scroll', onScroll);
			io?.disconnect();
		};
	});

	function start() {
		try {
			localStorage.setItem('sq:welcomed', '1');
		} catch {
			// Best-effort localStorage write; app navigates to onboarding regardless
		}
		goto(resolve('/budget?onboarding=1'));
	}
</script>

<svelte:head><title>Queuest — Know when to cancel</title></svelte:head>

<div class="relative overflow-hidden">
	<!-- Ambient glow blobs -->
	<div
		data-parallax="0.12"
		class="pointer-events-none absolute -right-28 -top-44 z-0 h-[520px] w-[520px] rounded-full"
		style="background:radial-gradient(circle,color-mix(in srgb,#f97316 26%,transparent),transparent 68%);filter:blur(20px)"
	></div>
	<div
		data-parallax="0.06"
		class="pointer-events-none absolute -left-40 top-[520px] z-0 h-[460px] w-[460px] rounded-full"
		style="background:radial-gradient(circle,color-mix(in srgb,#14b8a6 18%,transparent),transparent 70%);filter:blur(20px)"
	></div>

	<!-- ─── HERO ─────────────────────────────────────────────────────── -->
	<section id="top" class="relative z-10 mx-auto max-w-5xl px-6 pb-14 pt-16">
		<div class="grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
			<!-- Copy -->
			<div class="max-w-[560px]">
				<h1
					data-reveal
					class="mb-5 text-[clamp(36px,5.4vw,60px)] font-extrabold leading-[1.04] tracking-[-1.8px]"
				>
					Find out which streaming services are actually worth it.
				</h1>
				<p
					data-reveal
					class="mb-7 max-w-[480px] text-lg leading-relaxed text-gray-600 dark:text-gray-400"
				>
					Add the shows and movies you actually want to watch, see which service has them, and
					cancel everything else.
				</p>
				<div data-reveal class="flex flex-wrap items-center gap-3">
					{#if welcomed}
						<a
							href={resolve('/app')}
							class="rounded-2xl bg-orange-500 px-7 py-3.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110"
						>
							← Back to Queue
						</a>
					{:else}
						<button
							onclick={start}
							class="rounded-2xl bg-orange-500 px-7 py-3.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110"
						>
							Start your queue
						</button>
					{/if}
					<a
						href="#how"
						class="rounded-2xl bg-gray-100 px-6 py-3.5 text-[15px] font-semibold text-gray-900 transition-[filter] hover:brightness-95 dark:bg-gray-800 dark:text-gray-100"
					>
						See how it works
					</a>
				</div>
				<p data-reveal class="mt-5 text-[13px] text-gray-500">
					No card required · Free while in beta · End-to-end encrypted
				</p>
			</div>

			<!-- Product mock — always dark -->
			<div data-reveal class="relative z-10">
				<div
					class="overflow-hidden rounded-[20px]"
					class:mock-float={!motion.reduced}
					style="background:#0c1117;border:1px solid #1d2535;box-shadow:0 32px 64px -24px rgba(0,0,0,0.55)"
				>
					<!-- Mock header + tab switcher -->
					<div
						style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #1d2535"
					>
						<span style="font-size:13px;font-weight:700;color:#e5e7eb">Your Queue</span>
						<div style="display:flex;gap:2px;background:#161d2c;padding:3px;border-radius:8px">
							{#each [['cards', 'Grid'], ['list', 'List'], ['timeline', 'Gantt']] as const as [t, label] (t)}
								<button
									onclick={() => (tab = t)}
									style:background={tab === t ? '#1e2736' : 'transparent'}
									style:color={tab === t ? '#e5e7eb' : '#6b7280'}
									style="border:none;cursor:pointer;border-radius:5px;padding:4px 9px;font-size:11px;font-weight:600;transition:background .15s,color .15s"
									>{label}</button
								>
							{/each}
						</div>
					</div>

					<!-- GANTT tab -->
					{#if tab === 'timeline'}
						<div style="padding:14px 14px 10px">
							<div
								style="display:flex;justify-content:space-between;font-size:10px;color:#4b5563;margin-bottom:8px;padding-left:118px"
							>
								<span>0</span><span>{DEFAULT_BUDGET_HOURS}h / mo</span>
							</div>
							{#each mockLanes as lane, i (lane.label)}
								<div
									style="background:{lane.rowBg};border:1px solid {lane.rowBorder};border-radius:11px;display:flex;overflow:hidden;position:relative;{i <
									mockLanes.length - 1
										? 'margin-bottom:8px'
										: ''}"
								>
									<div
										style="width:108px;flex:none;padding:12px;border-right:1px solid {lane.rowBorder}"
									>
										<div
											style="width:32px;height:32px;border-radius:9px;background:{lane.logoBg};border:1px solid {lane.logoBorder};display:flex;align-items:center;justify-content:center;margin-bottom:6px"
										>
											<span
												style="font-size:{lane.logoTextSize};font-weight:900;color:{lane.logoTextColor}"
												>{lane.logoText}</span
											>
										</div>
										<div
											style="font-size:11px;font-weight:700;color:{lane.accent};margin-bottom:2px"
										>
											{lane.label}
										</div>
										<div style="font-size:9px;color:#4b5563">{lane.meta}</div>
									</div>
									<div
										style="flex:1;padding:12px;display:flex;align-items:center;gap:4px;overflow:hidden;position:relative"
									>
										{#each lane.bars as bar (bar.title)}
											<div
												style="display:flex;align-items:center;gap:7px;background:{lane.barBg};border:1px solid {lane.barBorder};border-radius:7px;padding:7px 10px;flex:none;width:{bar.width}"
											>
												<div
													style="width:22px;height:30px;border-radius:4px;background:{lane.barBorder};flex:none"
												></div>
												<div>
													<div style="font-size:11px;font-weight:600;color:#e5e7eb">
														{bar.title}
													</div>
													<div style="font-size:9px;color:{lane.accent}">{bar.time}</div>
												</div>
											</div>
										{/each}
										{#if lane.over}
											<div
												style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:#f97316;color:#fff;font-size:9px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap"
											>
												{lane.over}
											</div>
										{/if}
									</div>
								</div>
							{/each}
							<div style="text-align:center;font-size:9px;color:#374151;margin-top:9px">
								bar width = runtime · budget = {DEFAULT_BUDGET_HOURS}h / mo
							</div>
						</div>

						<!-- LIST tab -->
					{:else if tab === 'list'}
						<div style="padding:6px 8px 8px">
							{#each mockTitles as t, i (t.title)}
								<div
									style="display:flex;align-items:center;gap:10px;padding:10px;{i <
									mockTitles.length - 1
										? 'border-bottom:1px solid #1d2535'
										: ''}"
								>
									<div
										style="width:30px;height:44px;border-radius:5px;flex:none;background:{t.listPoster}"
									></div>
									<div style="flex:1;min-width:0">
										<div style="font-size:12px;font-weight:600;color:#e5e7eb;margin-bottom:4px">
											{t.title}
										</div>
										<div
											style="display:flex;align-items:center;gap:4px;margin-bottom:5px;flex-wrap:wrap"
										>
											{#each t.providers as p (p.label)}
												<span
													style="font-size:8px;font-weight:800;padding:2px 5px;border-radius:4px;background:{p.bg};color:{p.color}"
													>{p.label}</span
												>
											{/each}
											{#if t.seasons}
												<div style="display:flex;gap:2px">
													{#each WATCHED_SEASONS as s (s)}
														<span
															style="font-size:8px;padding:2px 4px;border-radius:3px;background:#1d2535;color:#6b7280;font-weight:600"
															>{s}</span
														>
													{/each}
													<span
														style="font-size:8px;padding:2px 4px;border-radius:3px;border:1px solid #f97316;color:#f97316;font-weight:600"
														>S5</span
													>
												</div>
											{/if}
										</div>
										<div style="display:flex;align-items:center;gap:7px">
											<div
												style="flex:1;height:4px;border-radius:2px;background:#1d2535;position:relative"
											>
												<div
													style="width:{t.pct}%;height:100%;border-radius:2px;background:#1ce783"
												></div>
												<div
													style="position:absolute;left:{t.pct}%;top:50%;transform:translate(-50%,-50%);width:8px;height:8px;border-radius:50%;background:#1ce783"
												></div>
											</div>
											<span style="font-size:10px;color:#6b7280;white-space:nowrap">{t.time}</span>
										</div>
									</div>
									<div style="display:flex;gap:3px">
										<button
											aria-label="Mark watched"
											style="border:1px solid #374151;background:transparent;color:#6b7280;border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center"
											>✓</button
										>
										<button
											aria-label="Remove"
											style="border:1px solid #374151;background:transparent;color:#6b7280;border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center"
											>×</button
										>
									</div>
								</div>
							{/each}
						</div>

						<!-- CARDS tab -->
					{:else}
						<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:11px">
							{#each mockTitles as t (t.title)}
								<div
									style="background:#0f1924;border:1px solid #1d2535;border-radius:11px;overflow:hidden"
								>
									<div style="height:110px;background:{t.cardPoster}"></div>
									<div style="padding:9px">
										<div style="font-size:11px;font-weight:600;color:#e5e7eb;margin-bottom:5px">
											{t.title}
										</div>
										<div style="display:flex;align-items:center;gap:5px;margin-bottom:5px">
											<div style="flex:1;height:3px;border-radius:2px;background:#1d2535">
												<div
													style="width:{t.pct}%;height:100%;border-radius:2px;background:#1ce783"
												></div>
											</div>
											<span style="font-size:9px;color:#6b7280">{t.time}</span>
										</div>
										<!-- Trailing gap sits on the last element before the buttons, so a
										     card with no seasons row keeps the same 7px as one with it. -->
										<div
											style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:{t.seasons
												? '4px'
												: '7px'}"
										>
											{#each t.providers as p (p.label)}
												<span
													style="font-size:8px;font-weight:800;padding:2px 5px;border-radius:3px;background:{p.bg};color:{p.color}"
													>{p.label}</span
												>
											{/each}
										</div>
										{#if t.seasons}
											<div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:7px">
												{#each WATCHED_SEASONS as s (s)}
													<span
														style="font-size:7px;padding:1px 4px;border-radius:3px;background:#1d2535;color:#6b7280;font-weight:600"
														>{s}</span
													>
												{/each}
												<span
													style="font-size:7px;padding:1px 4px;border-radius:3px;border:1px solid #f97316;color:#f97316;font-weight:600"
													>S5</span
												>
											</div>
										{/if}
										<div style="display:flex;gap:3px">
											<button
												style="flex:1;border:1px solid #374151;background:transparent;color:#6b7280;border-radius:5px;padding:4px 0;font-size:9px;cursor:pointer"
												>✓ Watched</button
											>
											<button
												aria-label="Remove"
												style="border:1px solid #374151;background:transparent;color:#6b7280;border-radius:5px;width:24px;font-size:9px;cursor:pointer"
												>×</button
											>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</section>

	<!-- ─── FEATURES ─────────────────────────────────────────────────── -->
	<section id="features" class="relative z-10 mx-auto max-w-5xl scroll-mt-20 px-6 py-16">
		<div data-reveal class="mb-10 max-w-[560px]">
			<div class="mb-3 text-[13px] font-bold tracking-[0.4px] text-orange-500">FEATURES</div>
			<h2 class="text-[clamp(28px,3.6vw,40px)] font-extrabold leading-tight tracking-[-1px]">
				Track what you watch. Cut what you don't.
			</h2>
		</div>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<div
				data-reveal
				class="rounded-[18px] border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
			>
				<div
					class="mb-4 flex h-[46px] w-[46px] flex-col items-center justify-center gap-1 rounded-[13px]"
					style="background:color-mix(in srgb,#f97316 12%,transparent)"
				>
					<span class="h-1 w-5 rounded-sm bg-orange-500"></span>
					<span class="h-1 w-5 rounded-sm bg-orange-500 opacity-70"></span>
					<span class="h-1 w-5 rounded-sm bg-orange-500 opacity-40"></span>
				</div>
				<h3 class="mb-2 text-lg font-bold tracking-[-0.3px]">Build your watchlist</h3>
				<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
					Drop in shows and movies as you hear about them. Queuest keeps them organized so nothing
					slips off your radar.
				</p>
			</div>

			<div
				data-reveal
				class="rounded-[18px] border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
			>
				<div
					class="mb-4 flex h-[46px] w-[46px] items-center justify-center rounded-[13px]"
					style="background:color-mix(in srgb,#f97316 12%,transparent)"
				>
					<span
						class="flex h-6 w-6 items-center justify-center rounded-full border-[3.5px] border-orange-500"
					>
						<span class="h-[7px] w-[7px] rounded-full bg-orange-500"></span>
					</span>
				</div>
				<h3 class="mb-2 text-lg font-bold tracking-[-0.3px]">See where it's streaming</h3>
				<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
					Every title in your list shows which services carry it right now — so you know exactly
					which subscription you actually need open.
				</p>
			</div>

			<div
				data-reveal
				class="rounded-[18px] border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
			>
				<div
					class="mb-4 flex h-[46px] w-[46px] items-center justify-center rounded-[13px]"
					style="background:color-mix(in srgb,#f97316 12%,transparent)"
				>
					<span
						class="h-6 w-6 rounded-full"
						style="background:conic-gradient(#f97316 0 30%,color-mix(in srgb,#f97316 22%,transparent) 30% 100%)"
					></span>
				</div>
				<h3 class="mb-2 text-lg font-bold tracking-[-0.3px]">Know what to cancel</h3>
				<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
					The Gantt view shows how long it takes to watch through your queue on each service. Thin
					queues are cancel candidates — thick ones are worth keeping.
				</p>
			</div>

			<div
				data-reveal
				class="rounded-[18px] border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
			>
				<div
					class="mb-4 flex h-[46px] w-[46px] items-center justify-center rounded-[13px]"
					style="background:color-mix(in srgb,#f97316 12%,transparent)"
				>
					<div class="grid grid-cols-2 gap-1">
						<span class="h-2.5 w-2.5 rounded-[3px] bg-orange-500"></span>
						<span class="h-2.5 w-2.5 rounded-[3px] bg-orange-500 opacity-70"></span>
						<span class="h-2.5 w-2.5 rounded-[3px] bg-orange-500 opacity-40"></span>
						<span class="h-2.5 w-2.5 rounded-[3px] bg-orange-500 opacity-25"></span>
					</div>
				</div>
				<h3 class="mb-2 text-lg font-bold tracking-[-0.3px]">Group it into Lists</h3>
				<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
					Date night, with the kids, horror October — organise your queue the way you actually think
					about it. Each list carries its own runtime total, so you know what you're signing up for.
				</p>
			</div>

			<div
				data-reveal
				class="rounded-[18px] border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
			>
				<div
					class="mb-4 flex h-[46px] w-[46px] items-center justify-center rounded-[13px]"
					style="background:color-mix(in srgb,#f97316 12%,transparent)"
				>
					<div class="flex items-end gap-1">
						<span class="h-4 w-5 rounded-[3px] border-[2.5px] border-orange-500"></span>
						<span class="h-3 w-2.5 rounded-[2px] bg-orange-500"></span>
					</div>
				</div>
				<h3 class="mb-2 text-lg font-bold tracking-[-0.3px]">Sync, without us reading it</h3>
				<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
					Turn on sync and your queue follows you to every device. It's encrypted on your device
					before it leaves — we only ever store ciphertext, so we can't read your queue even if we
					wanted to.
				</p>
			</div>

			<div
				data-reveal
				class="rounded-[18px] border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
			>
				<div
					class="mb-4 flex h-[46px] w-[46px] items-center justify-center rounded-[13px]"
					style="background:color-mix(in srgb,#f97316 12%,transparent)"
				>
					<div class="flex flex-col items-center">
						<div class="h-2 w-3 rounded-t-full border-[2.5px] border-b-0 border-orange-500"></div>
						<div class="flex h-3.5 w-5 items-center justify-center rounded-sm bg-orange-500">
							<div
								class="h-1 w-1 rounded-full"
								style="background:color-mix(in srgb,#f97316 10%,white)"
							></div>
						</div>
					</div>
				</div>
				<h3 class="mb-2 text-lg font-bold tracking-[-0.3px]">Yours, not ours</h3>
				<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
					No account needed to start — your queue lives on your device. Export it any time as an
					encrypted file you own, and delete everything in one click.
				</p>
			</div>
		</div>
	</section>

	<!-- ─── HOW IT WORKS ─────────────────────────────────────────────── -->
	<section
		id="how"
		class="relative z-10 scroll-mt-16 border-y border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-900/50"
	>
		<div class="mx-auto max-w-5xl px-6 py-16">
			<div data-reveal class="mb-11 max-w-[560px]">
				<div class="mb-3 text-[13px] font-bold tracking-[0.4px] text-orange-500">HOW IT WORKS</div>
				<h2 class="text-[clamp(28px,3.6vw,40px)] font-extrabold leading-tight tracking-[-1px]">
					Three steps to smarter streaming spend.
				</h2>
			</div>
			<div class="grid grid-cols-1 gap-7 sm:grid-cols-3">
				<div data-reveal>
					<div class="mb-3.5 text-5xl font-extrabold tracking-[-2px] text-orange-500">01</div>
					<h3 class="mb-2 text-lg font-bold">Set your watch budget</h3>
					<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
						Tell Queuest how many hours a month you want to watch and which services you're paying
						for. That's your baseline.
					</p>
				</div>
				<div data-reveal>
					<div class="mb-3.5 text-5xl font-extrabold tracking-[-2px] text-orange-500">02</div>
					<h3 class="mb-2 text-lg font-bold">Build your queue</h3>
					<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
						Add the shows and movies you actually want to see. Queuest finds where each one is
						streaming so you always know what to open.
					</p>
				</div>
				<div data-reveal>
					<div class="mb-3.5 text-5xl font-extrabold tracking-[-2px] text-orange-500">03</div>
					<h3 class="mb-2 text-lg font-bold">Trim your subscriptions</h3>
					<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
						The Gantt view shows how many hours of your queue live on each service. Cancel the ones
						you'd finish in a weekend — resubscribe when you're ready.
					</p>
				</div>
			</div>
		</div>
	</section>

	<!-- ─── BOTTOM CTA ───────────────────────────────────────────────── -->
	<section class="relative z-10 mx-auto max-w-5xl px-6 py-20">
		<div
			data-reveal
			class="relative overflow-hidden rounded-[26px] border border-gray-200 bg-white px-10 py-14 text-center dark:border-gray-800 dark:bg-gray-900"
		>
			<div
				class="pointer-events-none absolute inset-0"
				style="background:radial-gradient(circle at 50% -20%,color-mix(in srgb,#f97316 18%,transparent),transparent 60%)"
			></div>
			<div class="relative">
				<h2
					class="mb-3.5 text-[clamp(28px,4vw,44px)] font-extrabold leading-[1.08] tracking-[-1.2px]"
				>
					Stop guessing.<br />Start cancelling.
				</h2>
				<p
					class="mx-auto mb-7 max-w-[440px] text-base leading-relaxed text-gray-600 dark:text-gray-400"
				>
					Add what you want to watch, find out which services have it, and finally know what's worth
					paying for.
				</p>
				{#if welcomed}
					<a
						href={resolve('/app')}
						class="inline-block rounded-2xl bg-orange-500 px-9 py-4 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110"
					>
						← Back to Queue
					</a>
				{:else}
					<button
						onclick={start}
						class="rounded-2xl bg-orange-500 px-9 py-4 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110"
					>
						See what you're paying for — free
					</button>
				{/if}
			</div>
		</div>
	</section>

	<!-- ─── PAGE FOOTER ──────────────────────────────────────────────── -->
	<div class="relative z-10 border-t border-gray-200 dark:border-gray-800">
		<div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-6">
			<span class="text-base font-extrabold tracking-[-0.4px]"
				>Queu<span class="text-orange-500">est</span></span
			>
			<div class="flex gap-5">
				<a
					href="#features"
					class="text-[13px] text-gray-500 hover:text-gray-900 dark:hover:text-white">Features</a
				>
				<a href="#how" class="text-[13px] text-gray-500 hover:text-gray-900 dark:hover:text-white"
					>How it works</a
				>
				{#if welcomed}
					<a
						href={resolve('/app')}
						class="text-[13px] text-gray-500 hover:text-gray-900 dark:hover:text-white"
						>Back to Queue</a
					>
				{:else}
					<button
						onclick={start}
						class="text-[13px] text-gray-500 hover:text-gray-900 dark:hover:text-white"
						>Get started</button
					>
				{/if}
			</div>
			<div class="text-[12px] text-gray-500">© 2026 Queuest</div>
		</div>
	</div>
</div>

<style>
	@keyframes qfloat {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-12px);
		}
	}
	.mock-float {
		animation: qfloat 7s ease-in-out infinite;
	}
</style>
