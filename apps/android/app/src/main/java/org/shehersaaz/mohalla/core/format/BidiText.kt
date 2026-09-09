package org.shehersaaz.mohalla.core.format

/**
 * Keeping a Latin run intact inside an Urdu line.
 *
 * THE `@` MOVES, AND THAT IS THE WHOLE PROBLEM. A username is ASCII by rule
 * (BR-005), and `@sana_bashir` dropped into a right-to-left paragraph is a
 * left-to-right run preceded by a NEUTRAL character. The Unicode bidirectional
 * algorithm resolves a neutral by its surroundings, so the `@` takes the
 * paragraph's direction and is placed at the far end of the run — a correct
 * handle renders as `sana_bashir@`, and looks mistyped to the one person who
 * knows it is not.
 *
 * Nothing about the layout fixes this. It is not an alignment problem, so
 * `textAlign` cannot help; it is not a mirroring problem, so `LayoutDirection`
 * cannot either. It is resolved inside the string, by marking where the
 * left-to-right run begins and ends.
 *
 * [LRI] and [PDI] rather than the older `LRM` marks: an ISOLATE tells the
 * algorithm to treat the span as a single neutral object with respect to the
 * text around it, which is exactly what a handle in a sentence is. An embedding
 * would also fix the `@` and would let the run interact with a following
 * punctuation mark; an isolate does not.
 *
 * This affects every surface that shows a handle beside Urdu text: a search
 * result, a follower row, a profile header. It is one function so those cannot
 * disagree.
 */

/** U+2066 LEFT-TO-RIGHT ISOLATE. */
private const val LRI = '⁦'

/** U+2069 POP DIRECTIONAL ISOLATE. */
private const val PDI = '⁩'

/**
 * Wrap a left-to-right run so the surrounding paragraph cannot re-order it.
 *
 * Blank input is returned untouched — two invisible marks around nothing are
 * still two characters, and a "length" check somewhere downstream would see
 * them.
 */
fun ltr(text: String): String = if (text.isBlank()) text else "$LRI$text$PDI"
