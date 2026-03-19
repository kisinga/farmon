package main

import (
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"

	"github.com/farmon/firmware/pkg/settings"
)

// ─── Tokens ─────────────────────────────────────────────────────────────────

type cTokenType int

const (
	cTokNumber   cTokenType = iota
	cTokFieldRef            // f0, f1, f12, ...
	cTokIdent               // min, max, avg, ...
	cTokPlus
	cTokMinus
	cTokStar
	cTokSlash
	cTokLParen
	cTokRParen
	cTokComma
	cTokEOF
)

type cToken struct {
	typ cTokenType
	val string
	pos int
}

// ─── Lexer ──────────────────────────────────────────────────────────────────

func cTokenize(expr string) ([]cToken, error) {
	var tokens []cToken
	i := 0
	for i < len(expr) {
		ch := rune(expr[i])
		if unicode.IsSpace(ch) {
			i++
			continue
		}
		switch ch {
		case '+':
			tokens = append(tokens, cToken{cTokPlus, "+", i})
			i++
		case '-':
			tokens = append(tokens, cToken{cTokMinus, "-", i})
			i++
		case '*':
			tokens = append(tokens, cToken{cTokStar, "*", i})
			i++
		case '/':
			tokens = append(tokens, cToken{cTokSlash, "/", i})
			i++
		case '(':
			tokens = append(tokens, cToken{cTokLParen, "(", i})
			i++
		case ')':
			tokens = append(tokens, cToken{cTokRParen, ")", i})
			i++
		case ',':
			tokens = append(tokens, cToken{cTokComma, ",", i})
			i++
		default:
			if ch == '.' || (ch >= '0' && ch <= '9') {
				start := i
				for i < len(expr) && (expr[i] == '.' || (expr[i] >= '0' && expr[i] <= '9') || expr[i] == 'e' || expr[i] == 'E') {
					if (expr[i] == 'e' || expr[i] == 'E') && i+1 < len(expr) && (expr[i+1] == '+' || expr[i+1] == '-') {
						i += 2
						continue
					}
					i++
				}
				tokens = append(tokens, cToken{cTokNumber, expr[start:i], start})
			} else if ch == '_' || unicode.IsLetter(ch) {
				start := i
				for i < len(expr) && (expr[i] == '_' || unicode.IsLetter(rune(expr[i])) || unicode.IsDigit(rune(expr[i]))) {
					i++
				}
				word := expr[start:i]
				if len(word) > 1 && word[0] == 'f' && isAllDigits(word[1:]) {
					tokens = append(tokens, cToken{cTokFieldRef, word, start})
				} else {
					tokens = append(tokens, cToken{cTokIdent, word, start})
				}
			} else {
				return nil, fmt.Errorf("unexpected character '%c' at position %d", ch, i)
			}
		}
	}
	tokens = append(tokens, cToken{cTokEOF, "", len(expr)})
	return tokens, nil
}

func isAllDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return len(s) > 0
}

// ─── AST ────────────────────────────────────────────────────────────────────

type cNodeType int

const (
	cNodeNumber   cNodeType = iota
	cNodeFieldRef           // index stored in numVal
	cNodeBinaryOp           // op in strVal, children[0]=left, children[1]=right
	cNodeUnaryNeg           // children[0]=arg
	cNodeCall               // strVal=function name, children=args
)

type cNode struct {
	typ      cNodeType
	numVal   float64
	strVal   string
	children []*cNode
}

// ─── Parser ─────────────────────────────────────────────────────────────────

type cParser struct {
	tokens []cToken
	pos    int
}

func cParse(expr string) (*cNode, error) {
	tokens, err := cTokenize(expr)
	if err != nil {
		return nil, err
	}
	if len(tokens) == 1 && tokens[0].typ == cTokEOF {
		return nil, fmt.Errorf("empty expression")
	}
	p := &cParser{tokens: tokens}
	node, err := p.expression()
	if err != nil {
		return nil, err
	}
	if p.peek().typ != cTokEOF {
		return nil, fmt.Errorf("unexpected token '%s' at position %d", p.peek().val, p.peek().pos)
	}
	return node, nil
}

func (p *cParser) peek() cToken {
	if p.pos >= len(p.tokens) {
		return cToken{typ: cTokEOF, pos: len(p.tokens)}
	}
	return p.tokens[p.pos]
}

func (p *cParser) eat(typ cTokenType) (cToken, error) {
	t := p.peek()
	if t.typ != typ {
		return t, fmt.Errorf("expected token type %d but got '%s' at position %d", typ, t.val, t.pos)
	}
	p.pos++
	return t, nil
}

func (p *cParser) expression() (*cNode, error) {
	left, err := p.term()
	if err != nil {
		return nil, err
	}
	for p.peek().typ == cTokPlus || p.peek().typ == cTokMinus {
		op := p.peek().val
		p.pos++
		right, err := p.term()
		if err != nil {
			return nil, err
		}
		left = &cNode{typ: cNodeBinaryOp, strVal: op, children: []*cNode{left, right}}
	}
	return left, nil
}

func (p *cParser) term() (*cNode, error) {
	left, err := p.factor()
	if err != nil {
		return nil, err
	}
	for p.peek().typ == cTokStar || p.peek().typ == cTokSlash {
		op := p.peek().val
		p.pos++
		right, err := p.factor()
		if err != nil {
			return nil, err
		}
		left = &cNode{typ: cNodeBinaryOp, strVal: op, children: []*cNode{left, right}}
	}
	return left, nil
}

func (p *cParser) factor() (*cNode, error) {
	if p.peek().typ == cTokMinus {
		p.pos++
		arg, err := p.factor()
		if err != nil {
			return nil, err
		}
		return &cNode{typ: cNodeUnaryNeg, children: []*cNode{arg}}, nil
	}
	return p.primary()
}

func (p *cParser) primary() (*cNode, error) {
	t := p.peek()

	switch t.typ {
	case cTokNumber:
		p.pos++
		val, err := strconv.ParseFloat(t.val, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid number '%s' at position %d", t.val, t.pos)
		}
		return &cNode{typ: cNodeNumber, numVal: val}, nil

	case cTokFieldRef:
		p.pos++
		idx, _ := strconv.Atoi(t.val[1:])
		return &cNode{typ: cNodeFieldRef, numVal: float64(idx)}, nil

	case cTokIdent:
		p.pos++
		if p.peek().typ != cTokLParen {
			return nil, fmt.Errorf("unknown identifier '%s' at position %d; did you mean '%s(...)'?", t.val, t.pos, t.val)
		}
		p.pos++ // eat '('
		var args []*cNode
		if p.peek().typ != cTokRParen {
			arg, err := p.expression()
			if err != nil {
				return nil, err
			}
			args = append(args, arg)
			for p.peek().typ == cTokComma {
				p.pos++
				arg, err = p.expression()
				if err != nil {
					return nil, err
				}
				args = append(args, arg)
			}
		}
		if _, err := p.eat(cTokRParen); err != nil {
			return nil, fmt.Errorf("expected ')' for function '%s'", t.val)
		}
		return &cNode{typ: cNodeCall, strVal: t.val, children: args}, nil

	case cTokLParen:
		p.pos++
		node, err := p.expression()
		if err != nil {
			return nil, err
		}
		if _, err := p.eat(cTokRParen); err != nil {
			return nil, fmt.Errorf("expected ')'")
		}
		return node, nil

	default:
		return nil, fmt.Errorf("unexpected token '%s' at position %d", t.val, t.pos)
	}
}

// ─── Bytecode emitter ───────────────────────────────────────────────────────

// CompileExpression compiles a text expression to VM bytecode.
// Returns the bytecode or an error. Validates that the result fits
// within settings.MaxBytecodeLen (64 bytes).
func CompileExpression(expr string) ([]byte, error) {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return nil, fmt.Errorf("empty expression")
	}
	ast, err := cParse(expr)
	if err != nil {
		return nil, err
	}
	var buf []byte
	buf, err = emitNode(buf, ast)
	if err != nil {
		return nil, err
	}
	if len(buf) > settings.MaxBytecodeLen {
		return nil, fmt.Errorf("expression too complex: %d bytes exceeds %d-byte limit", len(buf), settings.MaxBytecodeLen)
	}
	return buf, nil
}

func emitNode(buf []byte, n *cNode) ([]byte, error) {
	switch n.typ {
	case cNodeNumber:
		buf = append(buf, byte(settings.OpPushF32))
		var b [4]byte
		binary.LittleEndian.PutUint32(b[:], math.Float32bits(float32(n.numVal)))
		buf = append(buf, b[:]...)
		return buf, nil

	case cNodeFieldRef:
		idx := int(n.numVal)
		if idx < 0 || idx > 255 {
			return nil, fmt.Errorf("field index f%d out of range (0-255)", idx)
		}
		buf = append(buf, byte(settings.OpLoadField), byte(idx))
		return buf, nil

	case cNodeBinaryOp:
		var err error
		buf, err = emitNode(buf, n.children[0])
		if err != nil {
			return nil, err
		}
		buf, err = emitNode(buf, n.children[1])
		if err != nil {
			return nil, err
		}
		switch n.strVal {
		case "+":
			buf = append(buf, byte(settings.OpAdd))
		case "-":
			buf = append(buf, byte(settings.OpSub))
		case "*":
			buf = append(buf, byte(settings.OpMul))
		case "/":
			buf = append(buf, byte(settings.OpDiv))
		default:
			return nil, fmt.Errorf("unknown operator '%s'", n.strVal)
		}
		return buf, nil

	case cNodeUnaryNeg:
		var err error
		buf, err = emitNode(buf, n.children[0])
		if err != nil {
			return nil, err
		}
		buf = append(buf, byte(settings.OpNeg))
		return buf, nil

	case cNodeCall:
		return emitCall(buf, n)

	default:
		return nil, fmt.Errorf("unknown node type")
	}
}

func emitCall(buf []byte, n *cNode) ([]byte, error) {
	var err error
	name := n.strVal
	args := n.children

	switch name {
	case "min":
		if len(args) != 2 {
			return nil, fmt.Errorf("min() requires 2 arguments, got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		buf, err = emitNode(buf, args[1])
		if err != nil {
			return nil, err
		}
		buf = append(buf, byte(settings.OpMin2))

	case "max":
		if len(args) != 2 {
			return nil, fmt.Errorf("max() requires 2 arguments, got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		buf, err = emitNode(buf, args[1])
		if err != nil {
			return nil, err
		}
		buf = append(buf, byte(settings.OpMax2))

	case "abs":
		if len(args) != 1 {
			return nil, fmt.Errorf("abs() requires 1 argument, got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		buf = append(buf, byte(settings.OpAbs))

	case "neg":
		if len(args) != 1 {
			return nil, fmt.Errorf("neg() requires 1 argument, got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		buf = append(buf, byte(settings.OpNeg))

	case "accum":
		if len(args) != 1 {
			return nil, fmt.Errorf("accum() requires 1 argument, got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		buf = append(buf, byte(settings.OpAccum))

	case "avg":
		if len(args) != 2 {
			return nil, fmt.Errorf("avg() requires 2 arguments (field, windowSize), got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		// Second arg must be an integer literal 1-16
		if args[1].typ != cNodeNumber {
			return nil, fmt.Errorf("avg() window size must be a number literal")
		}
		ws := int(args[1].numVal)
		if ws < 1 || ws > 16 {
			return nil, fmt.Errorf("avg() window size must be 1-16, got %d", ws)
		}
		buf = append(buf, byte(settings.OpWindowAvg), byte(ws))

	case "clamp":
		if len(args) != 3 {
			return nil, fmt.Errorf("clamp() requires 3 arguments (field, min, max), got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		if args[1].typ != cNodeNumber {
			return nil, fmt.Errorf("clamp() min must be a number literal")
		}
		if args[2].typ != cNodeNumber {
			return nil, fmt.Errorf("clamp() max must be a number literal")
		}
		buf = append(buf, byte(settings.OpClamp))
		var b [4]byte
		binary.LittleEndian.PutUint32(b[:], math.Float32bits(float32(args[1].numVal)))
		buf = append(buf, b[:]...)
		binary.LittleEndian.PutUint32(b[:], math.Float32bits(float32(args[2].numVal)))
		buf = append(buf, b[:]...)

	case "gt":
		if len(args) != 2 {
			return nil, fmt.Errorf("gt() requires 2 arguments, got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		buf, err = emitNode(buf, args[1])
		if err != nil {
			return nil, err
		}
		buf = append(buf, byte(settings.OpCmpGT))

	case "lt":
		if len(args) != 2 {
			return nil, fmt.Errorf("lt() requires 2 arguments, got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		buf, err = emitNode(buf, args[1])
		if err != nil {
			return nil, err
		}
		buf = append(buf, byte(settings.OpCmpLT))

	case "gte":
		if len(args) != 2 {
			return nil, fmt.Errorf("gte() requires 2 arguments, got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		buf, err = emitNode(buf, args[1])
		if err != nil {
			return nil, err
		}
		buf = append(buf, byte(settings.OpCmpGTE))

	case "lte":
		if len(args) != 2 {
			return nil, fmt.Errorf("lte() requires 2 arguments, got %d", len(args))
		}
		buf, err = emitNode(buf, args[0])
		if err != nil {
			return nil, err
		}
		buf, err = emitNode(buf, args[1])
		if err != nil {
			return nil, err
		}
		buf = append(buf, byte(settings.OpCmpLTE))

	default:
		return nil, fmt.Errorf("unknown function '%s'", name)
	}

	return buf, nil
}
