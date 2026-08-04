{
this
is some comment
}

unit simple_unit;

{$I synedit.inc}

interface

uses Classes, SysUtils;

type
  TSynCustom = class;
  SynBeautifierSetIndentProc =
      procedure(
        (* LinePos:
             1-based, the line that should be changed *)
        LinePos: Integer;
        (* Indent:
             New indent in spaces (Logical = Physical *)
        Indent: Integer;
        (* RelativeToLinePos:
             Indent specifies +/- offset from indent on RTLine (0: for absolute indent) *)
        RelativeToLinePos: Integer = 0;
        (* IndentChars:
             String used to build indent; maybe empty, single char, or string (usually 1 tab or 1 space)
             The String will be repeated and cut as needed, then filled with spaces at the end
           * NOTE: If this is specified the TSynBeautifierIndentType is ignored
        *)
        IndentChars: String = '';
        (* IndentCharsFromLinePos:
             Use tab/space mix from this Line for indent (if specified > 0)
             "IndentChars" will only be used, if the found tab/space mix is to short
           * NOTE: If this is specified the TSynBeautifierIndentType is ignored
        *)
        IndentCharsFromLinePos: Integer = 0
      ) of object;

  SynCustomBeautifier = class(TComponent)
  othervar: boolean;
  public
  normalvar: real;
  class var classvar:integer;
  private
    FCurrentEditor: TSynEditBase; // For callback / applyIndent
    FCurrentLines: TSynEditStrings;
  protected
      procedure DoBeforeCommand(const ACaret: TSynEditCaret;
                                var Command: TSynEditorCommand); virtual; abstract;
      procedure DoAfterCommand(const ACaret: TSynEditCaret;
                               var Command: TSynEditorCommand);      
  public
  function  GetCopy: TSynCustomBeautifier;
      procedure BeforeCommand(const Editor: TSynEditBase; const Lines: TSynEditStrings;
                              const ACaret: TSynEditCaret; var Command: TSynEditorCommand;
                              InitialCmd: TSynEditorCommand);  
    property AutoIndent: Boolean read FAutoIndent write FAutoIndent;    
end;


  TSynCustomBeautifierClass = class of TSynCustomBeautifier;
  TSynBeautifierIndentType = (
    sbitSpace, sbitCopySpaceTab,
    sbitPositionCaret,
    sbitConvertToTabSpace,   // convert to tabs, fill with spcaces if needed
    sbitConvertToTabOnly     // convert to tabs, even if shorter
  );

function dbgs(AExtendMode: TSynCommentExtendMode): String; overload;

implementation

var
 normalvar: string;

function dbgs(ACommentType: TSynCommentType): String;
begin
  Result := ''; WriteStr(Result, ACommentType);
end;

function dbgs(AContinueMode: TSynCommentContineMode): String;
begin
  Result := ''; WriteStr(Result, AContinueMode);
end;               

end.
