<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { initTheme } from '$lib/theme.svelte';
	import { initSyncTriggers } from '$lib/sync';
	import '$lib/motion.svelte';
	import { queueControls } from '$lib/queue-controls.svelte';
	import QueueDock from '$lib/components/QueueDock.svelte';

	let { children } = $props();

	// Default og:title/og:description — matches the copy that used to be
	// static in app.html. A route overrides either by returning ogTitle /
	// ogDescription from its own load() (see lists/join/[token] and
	// lists/[id] for #219); everything else falls back to these.
	const DEFAULT_OG_TITLE = 'Queuest';
	const DEFAULT_OG_DESCRIPTION =
		'Figure out how long you actually need a streaming subscription — before paying for another month.';
	let ogTitle = $derived(page.data?.ogTitle ?? DEFAULT_OG_TITLE);
	let ogDescription = $derived(page.data?.ogDescription ?? DEFAULT_OG_DESCRIPTION);

	const navLinks = [
		{ href: '/budget', label: 'Budget', exact: false },
		{ href: '/add', label: 'Add', exact: false },
		{ href: '/app', label: 'Queue', exact: true },
		{ href: '/lists', label: 'Lists', exact: true }
	] as const;

	const settingsLink = { href: '/settings', label: 'Settings', exact: false } as const;
	const allTabs = [...navLinks, settingsLink];

	function isActive(href: string, exact: boolean) {
		return exact ? page.url.pathname === href : page.url.pathname.startsWith(href);
	}

	let isLanding = $derived(page.url.pathname === '/');
	let isQueue = $derived(page.url.pathname === '/app');

	// Folder-tab curve: a single continuous line along the nav's bottom edge
	// that rises into a smooth "hill" under whichever tab is active, instead
	// of being erased/faked behind a filled box. Coordinates are measured
	// pixels (no viewBox) so they line up 1:1 with the tab-row's own box.
	let tabRowEl: HTMLDivElement | undefined = $state();
	const tabRefs = new SvelteMap<string, HTMLAnchorElement>();
	let curveD = $state('');
	let fillD = $state('');

	function tabRef(node: HTMLAnchorElement, href: string) {
		tabRefs.set(href, node);
		return {
			destroy() {
				tabRefs.delete(href);
			}
		};
	}

	function updateCurve() {
		if (!tabRowEl) return;
		const active = allTabs.find((t) => isActive(t.href, t.exact));
		const el = active && tabRefs.get(active.href);
		if (!el) {
			curveD = '';
			fillD = '';
			return;
		}
		const container = tabRowEl.getBoundingClientRect();
		const tab = el.getBoundingClientRect();
		const H = container.height;
		const W = container.width;
		const left = tab.left - container.left;
		const right = tab.right - container.left;
		// Rounder bezel — a wider spread reads as a smoother, sleeker curve.
		const spread = window.innerWidth < 640 ? 40 : 50;
		// The cubic bezier below is nearly flat for the first several px out of
		// the plateau — that's wasted as pure-flat plateau otherwise. Letting
		// the plateau undercut the text by `overlap` lets the text's own edges
		// sit on that already-flat-looking curve start instead, shrinking the
		// total horizontal footprint without changing the slope's run (spread)
		// or curvature at all.
		const overlap = window.innerWidth < 640 ? 8 : 10;
		// Clamp so a very narrow tab (or a future shorter label) can't invert
		// the plateau — collapses to a single point at the tab's center instead.
		const mid = (left + right) / 2;
		const plateauLeft = Math.min(left + overlap, mid);
		const plateauRight = Math.max(right - overlap, mid);
		// Hug the tab's own text box (a few px of breathing room above it) instead
		// of a fixed inset, so the hill's height tracks the text's actual height.
		const top = Math.max(4, tab.top - container.top - 4);
		const x1 = Math.max(0, plateauLeft - spread);
		const x2 = Math.min(W, plateauRight + spread);
		const midL = (x1 + plateauLeft) / 2;
		const midR = (plateauRight + x2) / 2;
		curveD =
			`M0,${H} L${x1},${H} ` +
			`C${midL},${H} ${midL},${top} ${plateauLeft},${top} ` +
			`L${plateauRight},${top} ` +
			`C${midR},${top} ${midR},${H} ${x2},${H} ` +
			`L${W},${H}`;
		fillD = `${curveD} L${W},${H} L0,${H} Z`;
	}

	// ── Swipe navigation (#162) ────────────────────────────────────────────
	// Horizontal swipe on the page body moves between the main tabs, in the
	// same left-to-right order as the nav strip. The tab curve's own
	// transition (see the `d`/`fill` transitions on the <path>s below) is
	// what sells "the tab is moving" — no separate page-content animation.
	const SWIPE_MIN_DISTANCE = 60;
	const SWIPE_MAX_OFF_AXIS = 60;
	const SWIPE_MAX_DURATION_MS = 600;

	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;

	/** Shared by swipe and the #168 keyboard shortcut: step to the adjacent
	 * main tab, or no-op past the first/last one or off a main-tab page. */
	function stepTab(direction: 1 | -1) {
		const currentIndex = navLinks.findIndex((l) => isActive(l.href, l.exact));
		if (currentIndex === -1) return; // not on a main-tab page (settings, search, landing)
		const target = navLinks[currentIndex + direction];
		if (target) void goto(resolve(target.href));
	}

	function handleTouchStart(e: TouchEvent) {
		const target = e.target as Element;
		// data-detail-panel: DetailPanel's cast list scrolls horizontally.
		// data-queue-dock: the floating filter dock — dense controls, not a swipe surface.
		if (target.closest('[data-detail-panel], [data-queue-dock]')) return;
		const t = e.touches[0];
		touchStartX = t.clientX;
		touchStartY = t.clientY;
		touchStartTime = Date.now();
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!touchStartTime) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - touchStartX;
		const dy = t.clientY - touchStartY;
		const dt = Date.now() - touchStartTime;
		touchStartTime = 0;

		if (dt > SWIPE_MAX_DURATION_MS) return;
		if (Math.abs(dy) > SWIPE_MAX_OFF_AXIS) return; // vertical scroll, not a swipe
		if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return;

		stepTab(dx < 0 ? 1 : -1);
	}

	// ── Keyboard navigation (#168) — the desktop equivalent of swipe. ───────
	// Alt+ArrowRight/Left steps between tabs, same order and boundary
	// behavior as the swipe. Skipped while focus is in a text input/textarea
	// so it doesn't fight the OS/browser's own Alt+arrow text-navigation
	// shortcuts, and skipped on Mac's Option+Arrow-as-word-jump equivalent
	// for the same reason (both land here as e.altKey).
	function handleKeydown(e: KeyboardEvent) {
		if (!e.altKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
		// e.target is `document` itself, not an Element, when nothing has focus.
		if (
			e.target instanceof Element &&
			e.target.closest('input, textarea, [contenteditable="true"]')
		)
			return;
		e.preventDefault();
		stepTab(e.key === 'ArrowRight' ? 1 : -1);
	}

	onMount(() => {
		initTheme();
		// No-ops until sync is actually enabled (#103's job) — syncNow() bails
		// immediately when there's no DEK in IndexedDB yet. Registering the
		// triggers unconditionally here just means enabling sync later doesn't
		// also require wiring app-load/visibilitychange/debounce from scratch.
		initSyncTriggers();
		// iOS Safari misreports viewport width during keyboard animation (and after
		// native pickers dismiss), making sm: breakpoints fire on narrow screens.
		// Re-stamping the viewport meta on every resize corrects it.
		function fixViewport() {
			const vp = document.querySelector<HTMLMetaElement>('meta[name=viewport]');
			if (vp) vp.content = 'width=device-width, initial-scale=1';
		}
		window.addEventListener('resize', fixViewport);
		window.addEventListener('resize', updateCurve);
		updateCurve();
		return () => {
			window.removeEventListener('resize', fixViewport);
			window.removeEventListener('resize', updateCurve);
		};
	});

	$effect(() => {
		// Re-measure whenever the active tab changes (route change).
		void page.url.pathname;
		tick().then(updateCurve);
	});
</script>

<svelte:head>
	<meta property="og:title" content={ogTitle} />
	<meta property="og:description" content={ogDescription} />
	<meta name="twitter:title" content={ogTitle} />
	<meta name="twitter:description" content={ogDescription} />
</svelte:head>

<svelte:document
	onclick={(e) => {
		const t = e.target as Element;
		if (queueControls.filterOpen && !t.closest('[data-queue-dock]'))
			queueControls.filterOpen = false;
	}}
	onkeydown={handleKeydown}
/>

<div class="min-h-screen w-full bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
	<nav class="sticky top-0 z-50 bg-white/90 backdrop-blur dark:bg-gray-900/90">
		<div
			bind:this={tabRowEl}
			class="relative mx-auto flex h-8 max-w-5xl items-stretch gap-5 px-1 sm:h-10 sm:gap-6 sm:px-2"
		>
			<svg class="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
				<path
					d={fillD}
					class="fill-gray-50 transition-[d] duration-200 ease-out dark:fill-gray-950"
				/>
				<path
					d={curveD}
					class="stroke-gray-200 transition-[d] duration-200 ease-out dark:stroke-gray-800"
					fill="none"
					stroke-width="1"
					vector-effect="non-scaling-stroke"
				/>
			</svg>

			<a
				class="relative z-10 flex items-center text-base font-bold tracking-tight text-gray-900 sm:text-xl dark:text-white"
				href={resolve('/')}
			>
				Queu<span class="text-orange-400">est</span>
			</a>

			{#if !isLanding}
				<!-- Extra breathing room after the logo, on top of the container's own
				     gap — isolated here rather than raising that gap, which would space
				     out every item in the row (tabs, dock, Settings), not just this one. -->
				<div class="w-2 sm:w-3" aria-hidden="true"></div>

				<!-- Folder-tab strip: the active link's "raised, connected" look comes from the
				     SVG line drawn above, which curves up into a short hill under whichever tab
				     is active and fills the area under it with the page background — a real
				     continuous line, not a corner cut out of a straight border. -->
				<div class="flex items-end gap-5 sm:gap-6">
					{#each navLinks as link (link.href)}
						{@const active = isActive(link.href, link.exact)}
						<a
							use:tabRef={link.href}
							class="relative z-10 flex items-center px-0 py-1.5 text-xs font-medium transition-colors sm:px-0.5 sm:py-2 sm:text-sm
								{active
								? 'text-gray-900 dark:text-white'
								: 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
							href={resolve(link.href)}
						>
							{link.label}
						</a>
					{/each}
				</div>
			{/if}

			<div class="flex-1"></div>

			{#if isQueue && queueControls.ready && queueControls.hasItems}
				<!-- Inline nav placement (lg+ only) — the mobile/tablet floating placement lives
				     outside <nav> below, since backdrop-filter on <nav> would otherwise confine a
				     fixed-position dock to the nav's own box (see QueueDock.svelte). -->
				<div class="hidden self-center lg:block">
					<QueueDock floating={false} />
				</div>
			{/if}

			{#if !isLanding}
				{@const settingsActive = isActive(settingsLink.href, settingsLink.exact)}
				<a
					use:tabRef={settingsLink.href}
					class="relative z-10 flex items-center self-end py-1 pl-1 pr-2 text-xs font-medium transition-colors sm:py-1.5 sm:pl-2 sm:pr-4 sm:text-sm
					{settingsActive
						? 'text-gray-900 dark:text-white'
						: 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}"
					href={resolve('/settings')}
					aria-label="Settings"
				>
					<svg class="h-4 w-4 sm:hidden" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 011.262.125l.962.962a1 1 0 01.125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 01.804.98v1.361a1 1 0 01-.804.98l-1.473.295a6.95 6.95 0 01-.587 1.416l.834 1.25a1 1 0 01-.125 1.262l-.962.962a1 1 0 01-1.262.125l-1.25-.834a6.953 6.953 0 01-1.416.587l-.294 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a6.957 6.957 0 01-1.416-.587l-1.25.834a1 1 0 01-1.262-.125l-.962-.962a1 1 0 01-.125-1.262l.834-1.25a6.957 6.957 0 01-.587-1.416l-1.473-.294A1 1 0 011 10.68V9.32a1 1 0 01.804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 01.125-1.262l.962-.962A1 1 0 015.38 3.03l1.25.834a6.957 6.957 0 011.416-.587l.294-1.473zM13 10a3 3 0 11-6 0 3 3 0 016 0z"
							clip-rule="evenodd"
						/>
					</svg>
					<span class="hidden sm:inline">Settings</span>
				</a>
			{/if}
		</div>
	</nav>

	{#if isQueue && queueControls.ready && queueControls.hasItems}
		<!-- Floating placement (below lg:) — deliberately outside <nav>, see the comment
		     on the inline instance above for why. -->
		<div class="lg:hidden">
			<QueueDock floating={true} />
		</div>
	{/if}

	<main
		class="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-8"
		ontouchstart={handleTouchStart}
		ontouchend={handleTouchEnd}
	>
		{@render children()}
	</main>

	<footer class="mt-8 border-t border-gray-200 py-4 sm:mt-16 sm:py-6 dark:border-gray-800">
		<div
			class="mx-auto flex max-w-5xl flex-col items-center gap-2 px-3 sm:flex-row sm:justify-between sm:px-4"
		>
			<img
				src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg"
				alt="The Movie Database (TMDB)"
				class="h-3.5 opacity-70 sm:h-4"
			/>
			<p class="text-center text-[10px] text-gray-500 sm:text-right sm:text-xs">
				This website uses TMDB and the TMDB APIs but is not endorsed or approved by TMDB.
			</p>
		</div>
	</footer>
</div>
