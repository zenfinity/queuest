<script lang="ts">
	// The shared "orange primary action" look (#194) — color, hover, and the
	// disabled-state opacity were duplicated ~20 times across the app with a
	// couple of drifted `disabled:opacity-*` values. Padding/text-size stay
	// per call site (via `class`) since they genuinely vary by context; this
	// component only owns the part that shouldn't drift.
	//
	// Renders as an <a> when `href` is given, so link-styled CTAs (e.g. the
	// error page's "Return to Queue") share the same visual rules as real
	// <button>s instead of re-declaring them.
	import type { Snippet } from 'svelte';

	let {
		href,
		type = 'button',
		disabled = false,
		class: className = '',
		onclick,
		children
	}: {
		href?: string;
		type?: 'button' | 'submit';
		disabled?: boolean;
		class?: string;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	} = $props();

	// inline-flex (not inline-block): the <a> branch is otherwise `display:
	// inline` by UA default, which silently drops width/vertical-margin and
	// makes vertical padding overflow the line box instead of expanding it —
	// exactly the bug in #264. inline-flex fixes all three and centers
	// content for call sites with a trailing glyph (e.g. "Go to my queue →").
	const base =
		'inline-flex items-center justify-center rounded-lg bg-orange-500 font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50';
</script>

{#if href}
	<!-- Every call site passes an href built via resolve() (or an external URL);
	     the rule can't see through this component's prop boundary. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a {href} class="{base} {className}">
		{@render children()}
	</a>
{:else}
	<button {type} {disabled} {onclick} class="{base} {className}">
		{@render children()}
	</button>
{/if}
