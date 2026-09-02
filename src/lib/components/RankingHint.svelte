<script lang="ts">
	// In-flow nudge toward ranked-choice voting on a shared list (#242,
	// formerly a floating pill — #210/#191). Rendered above the ballot rows
	// in SharedListSection's rankings panel, where the trigger condition
	// (title count, this viewer's own ballot) already lives — disappears on
	// its own once the viewer ranks anything, no dismissal key needed.
	let { collaborator = 'the group', maxSize }: { collaborator?: string; maxSize: number } =
		$props();
</script>

<p
	class="mb-1.5 border-l-2 border-orange-400 pl-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
>
	Star up to {maxSize}. {collaborator}'s stars combine with yours into one ranking.
</p>
