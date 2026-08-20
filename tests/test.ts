import test from "node:test";
import assert from "node:assert/strict";
import prettier from "prettier";
import pascalPlugin from "../dist/index";

async function formatPascal(code: string): Promise<string> {
  return await prettier.format(code, {
    parser: "pascal",
    plugins: [pascalPlugin],
    printWidth: 80,
    tabWidth: 2, 
  });
}

test("Pascal Prettier Plugin Test Suite", async (t) => {

  await t.test("Formats basic procedural declarations and forward references", async () => {
    const unformatted = `program a; begin procedure   Calculate( x:Integer;y:Integer) ;forward  ;end.`;
    
    // Testing` the `declProcFwd` grammar node and your `printDeclProc` logic
    const expected = `program a;\nbegin\n  procedure\n  Calculate\n  (x: Integer; y: Integer);\n  forward;\nend.\n`;
    
    const result = await formatPascal(unformatted);
    assert.equal(result, expected);
  });

  await t.test("Formats if/else expressions inline", async () => {
    const unformatted = `program b; begin Result:=if   x=1   then 'One' else   'Other'  ;end.`;
    
    // Testing the `exprIf` grammar node and `printIfElse` routing
    const expected = `program b;\nbegin\n  Result := if x = 1 then 'One' else 'Other';\nend.\n`;
    
    const result = await formatPascal(unformatted);
    assert.equal(result, expected);
  });

  await t.test("Formats arrays with ranges and subscripts", async () => {
    const unformatted = `program c; var MyArr : array [ 1 .. 10 ] of  Integer ;
begin
MyArr [ 5 ]  := 100 ;
end.`;

    // Testing `range`, `exprSubscript`, and `printDeclArray` logic
    const expected = `program c;\nvar\n  MyArr: array[1..10] of Integer;\nbegin\n  MyArr[5] := 100;\nend.\n`;
    
    const result = await formatPascal(unformatted);
    assert.equal(result, expected);
  });

  await t.test("Formats case statements safely", async () => {
    const unformatted = `program d; begin case i of 1..5:begin DoWork; end; otherwise DoNothing; end;end.`;

    // Testing `caseCase` and `printCase` handlers
    const expected = `program d;\nbegin\n  case i of\n    1..5:\n      begin\n        DoWork;\n      end;\n    otherwise DoNothing;\n  end;\nend.\n`;
    
    const result = await formatPascal(unformatted);
    assert.equal(result, expected);
  });
  
  await t.test("Formats FPC procedural variable assignments with address operator", async () => {
    const unformatted = `program e; begin LogCallback :=    @PrintLog ;end.`;

    // Testing the unary `kAt` operator inside an assignment
    const expected = `program e;\nbegin\n  LogCallback := @PrintLog;\nend.\n`;
    
    const result = await formatPascal(unformatted);
    assert.equal(result, expected);
  });

});
